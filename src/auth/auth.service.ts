import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Register } from './dtos/Register.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Login } from './dtos/Login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { AuthResponse, SafeUser } from './dtos/AuthResponse.dto';
import { OAuthLoginDto } from './dtos/oauth-login.dto';
import { ForgotPassword } from './dtos/ForgotPassword.dto';
import { ResetPassword } from './dtos/ResetPassword.dto';
import { OAuthProfile } from './interfaces/google-profile.interface';
import { OAuth2Client } from 'google-auth-library';
import { EAuthProvider } from './enums/provider.enum';
import { MailService } from '@/mail/mail.service';
import { PrismaService } from '@/prisma/prisma.service';
import { User } from '@generated/client';
import { UserRole, AuthProvider } from '@generated/enums';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
  private readonly googleClientId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: MailService,
  ) {
    this.googleClientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
  }

  async register(registerDto: Register): Promise<AuthResponse> {
    const { email, password, firstName, lastName, role } = registerDto;

    return this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        if (existingUser.deletedAt) {
          return this.restoreUser(existingUser.id, password);
        }
        throw new ConflictException('User already exists');
      }

      // Validate password strength
      this.validatePasswordStrength(password);

      const hashedPassword = await this.hashPassword(password);
      const { plainToken, hashedToken } =
        await this.generateVerificationToken();

      const user = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          password: hashedPassword,
          firstName: firstName?.trim(),
          lastName: lastName?.trim(),
          role: role || UserRole.ANALYST,
          emailVerificationToken: hashedToken,
          emailVerificationSentAt: new Date(),
          provider: AuthProvider.LOCAL,
          lastPasswordChange: new Date(),
        },
      });

      const tokens = await this.generateTokens(user);

      // Send verification email (non-blocking)
      //this.sendVerificationEmail(user.email, plainToken);

      this.logger.log(`New user registered: ${user.email}`);
      return {
        user: this.toSafeUser(user),
        ...tokens,
        requiresEmailVerification: !user.isEmailVerified,
      };
    });
  }

  async login(loginDto: Login): Promise<AuthResponse> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: loginDto.email.toLowerCase(),
        deletedAt: null,
        provider: AuthProvider.LOCAL, // Ensure local auth user
      },
    });

    if (!user) {
      // Simulate delay to prevent timing attacks
      await this.simulateProcessingDelay();
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(
        `Account temporarily locked. Try again at ${user.lockedUntil.toISOString()}`,
      );
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      await this.handleFailedLogin(user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset security counters on successful login
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
        lastActiveAt: new Date(),
      },
    });

    const tokens = await this.generateTokens(user);
    this.logger.log(`User logged in: ${user.email}`);

    return {
      user: this.toSafeUser(user),
      ...tokens,
      requiresEmailVerification: !user.isEmailVerified,
    };
  }

  async handleOAuthCallback(
    provider: EAuthProvider,
    code: string,
  ): Promise<AuthResponse> {
    const profile = await this.getProfileFromCode(provider, code);
    return this.loginWithOAuth(profile);
  }

  async loginWithOAuth(profile: OAuthLoginDto): Promise<AuthResponse> {
    const { provider } = profile;
    return this.prisma.$transaction(async (tx) => {
      const providerField = this.getProviderField(provider);

      let user = await tx.user.findFirst({
        where: {
          [providerField]: profile.id,
          deletedAt: null,
        },
      });

      if (!user && profile.email) {
        user = await tx.user.findFirst({
          where: {
            email: profile.email.toLowerCase(),
            deletedAt: null,
          },
        });

        if (user) {
          // Link OAuth provider to existing account
          user = await tx.user.update({
            where: { id: user.id },
            data: {
              [providerField]: profile.id,
              avatar: profile.avatar || user.avatar,
              isEmailVerified: user.isEmailVerified || true, // Don't override if already verified
              lastActiveAt: new Date(),
            },
          });
        }
      }

      if (!user) {
        // Create new OAuth user
        user = await tx.user.create({
          data: {
            email: profile.email.toLowerCase(),
            firstName: profile.firstName?.trim(),
            lastName: profile.lastName?.trim(),
            avatar: profile.avatar,
            provider,
            [providerField]: profile.id,
            isEmailVerified: true, // OAuth emails are typically verified
            role: UserRole.ANALYST,
            lastActiveAt: new Date(),
          },
        });
      } else {
        // Update last active for existing user
        user = await tx.user.update({
          where: { id: user.id },
          data: { lastActiveAt: new Date() },
        });
      }

      const tokens = await this.generateTokens(user);
      this.logger.log(`OAuth login successful: ${user.email} via ${provider}`);

      return {
        user: this.toSafeUser(user),
        ...tokens,
        requiresEmailVerification: false, // OAuth users are auto-verified
      };
    });
  }

  async getOAuthRedirectUrl(provider: EAuthProvider): Promise<string> {
    if (provider === EAuthProvider.GOOGLE) {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: process.env.GOOGLE_CALLBACK_URL,
        response_type: 'code',
        scope: 'openid email profile',
        access_type: 'offline', // optional: lets you get refresh tokens
        prompt: 'consent',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    }
    throw new BadRequestException('Unsupported provider');
  }

  async getProfileFromCode(
    provider: EAuthProvider,
    code: string,
  ): Promise<OAuthLoginDto> {
    if (provider === EAuthProvider.GOOGLE) {
      const decodedCode = decodeURIComponent(code);
      // 1. Exchange code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: decodedCode,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: process.env.GOOGLE_CALLBACK_URL,
          grant_type: 'authorization_code',
        }),
      });
      const tokens = await tokenResponse.json();

      // 2. Fetch user profile
      const profileResponse = await fetch(
        'https://openidconnect.googleapis.com/v1/userinfo',
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        },
      );
      const profile = await profileResponse.json();

      return {
        provider: AuthProvider.GOOGLE,
        id: profile.sub,
        email: profile.email,
        firstName: profile.given_name,
        lastName: profile.family_name,
        avatar: profile.picture,
      } as OAuthLoginDto;
    }
    throw new BadRequestException('Unsupported provider');
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponse> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub, deletedAt: null },
      });

      if (!user) throw new UnauthorizedException('User not found');

      // Update last active timestamp
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      });

      const tokens = await this.generateTokens(user);
      return {
        user: this.toSafeUser(user),
        ...tokens,
        requiresEmailVerification: !user.isEmailVerified,
      };
    } catch (error) {
      this.logger.warn('Invalid refresh token attempt');
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async verifyEmail(token: string): Promise<void> {
    // Find user by token with expiration check (24 hours)
    const expirationTime = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const user = await this.prisma.user.findFirst({
      where: {
        emailVerificationToken: { not: null },
        emailVerificationSentAt: { gte: expirationTime },
        deletedAt: null,
      },
    });

    if (!user || !(await bcrypt.compare(token, user.emailVerificationToken))) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationSentAt: null,
      },
    });

    this.logger.log(`Email verified for user: ${user.email}`);
  }

  async forgotPassword(dto: ForgotPassword): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: {
        email: dto.email.toLowerCase(),
        deletedAt: null,
        provider: AuthProvider.LOCAL, // Only allow for local auth users
      },
    });

    if (!user) {
      // Simulate processing to prevent email enumeration
      await this.simulateProcessingDelay();
      return;
    }

    const { plainToken, hashedToken } = await this.generateVerificationToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const _user = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: resetExpires,
      },
    });

    this.emailService
      .sendPasswordResetEmail(user.email, plainToken)
      .catch((err) => this.logger.error('Failed to send reset email:', err));

    this.logger.log(`Password reset requested for: ${user.email}`);
    return _user;
  }

  async resetPassword(dto: ResetPassword): Promise<void> {
    // Find user with valid reset token (not expired)
    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordToken: { not: null },
        resetPasswordExpires: { gt: new Date() },
        deletedAt: null,
      },
    });

    if (!user || !(await bcrypt.compare(dto.token, user.resetPasswordToken))) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    this.validatePasswordStrength(dto.password);

    const hashedPassword = await this.hashPassword(dto.password);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
        loginAttempts: 0,
        lockedUntil: null,
        lastPasswordChange: new Date(),
      },
    });

    this.logger.log(`Password reset successful for ${user.email}`);
  }

  async resendVerificationEmail(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        deletedAt: null,
        isEmailVerified: false,
      },
    });

    if (!user) return; // Silent fail for security

    const { plainToken, hashedToken } = await this.generateVerificationToken();

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: hashedToken,
        emailVerificationSentAt: new Date(),
      },
    });

    //this.sendVerificationEmail(user.email, plainToken);
  }

  // OAuth profile methods remain similar but with better error handling
  async getOAuthProfile(
    provider: 'google' | 'facebook' | 'linkedin',
    token: string,
  ): Promise<OAuthProfile> {
    try {
      switch (provider) {
        case 'google':
          return await this.getGoogleProfile(token);
        case 'facebook':
          return await this.getFacebookProfile(token);
        case 'linkedin':
          return await this.getLinkedInProfile(token);
        default:
          throw new UnauthorizedException('Unsupported OAuth provider');
      }
    } catch (error) {
      this.logger.error(`OAuth profile fetch failed for ${provider}:`, error);
      throw new UnauthorizedException(
        `Failed to authenticate with ${provider}`,
      );
    }
  }

  // ... OAuth profile methods (improved with timeout and better error handling)

  private async generateTokens(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_SECRET'),
        expiresIn: this.configService.get('JWT_EXPIRES_IN', '7d'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async handleFailedLogin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const newAttempts = user.loginAttempts + 1;
    let lockedUntil: Date | null = null;

    if (newAttempts >= this.MAX_LOGIN_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + this.LOCKOUT_DURATION_MS);
      this.logger.warn(
        `Account locked for user ${user.email} until ${lockedUntil}`,
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        loginAttempts: newAttempts,
        lockedUntil,
        lastActiveAt: new Date(), // Track failed attempt activity
      },
    });
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  private async generateVerificationToken(): Promise<{
    plainToken: string;
    hashedToken: string;
  }> {
    const plainToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = await bcrypt.hash(plainToken, 12);
    return { plainToken, hashedToken };
  }

  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new BadRequestException(
        'Password must be at least 8 characters long',
      );
    }

    const strengthChecks = {
      hasLowercase: /[a-z]/.test(password),
      hasUppercase: /[A-Z]/.test(password),
      hasNumbers: /\d/.test(password),
      hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    };

    const strengthScore = Object.values(strengthChecks).filter(Boolean).length;

    if (strengthScore < 3) {
      throw new BadRequestException(
        'Password must contain at least 3 of the following: lowercase, uppercase, numbers, special characters',
      );
    }
  }

  private async simulateProcessingDelay(): Promise<void> {
    // Add random delay between 100-500ms to prevent timing attacks
    const delay = Math.random() * 400 + 100;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private sendVerificationEmail(email: string, token: string): void {
    this.emailService
      .sendVerificationEmail(email, token)
      .catch((err) =>
        this.logger.error('Failed to send verification email:', err),
      );
  }

  private getProviderField(provider: AuthProvider): string {
    const providerMap: Record<AuthProvider, string> = {
      [AuthProvider.GOOGLE]: 'googleId',
      [AuthProvider.FACEBOOK]: 'facebookId',
      [AuthProvider.LINKEDIN]: 'linkedinId',
      [AuthProvider.LOCAL]: 'password', // Not used for OAuth
    };

    return providerMap[provider];
  }

  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      lastActiveAt: user.lastActiveAt,
    };
  }

  private async restoreUser(
    userId: string,
    newPassword: string,
  ): Promise<AuthResponse> {
    this.validatePasswordStrength(newPassword);
    const hashedPassword = await this.hashPassword(newPassword);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        deletedAt: null,
        loginAttempts: 0,
        lockedUntil: null,
        lastActiveAt: new Date(),
        lastPasswordChange: new Date(),
      },
    });

    const tokens = await this.generateTokens(user);
    this.logger.log(`Restored previously deleted user: ${user.email}`);

    return {
      user: this.toSafeUser(user),
      ...tokens,
      requiresEmailVerification: !user.isEmailVerified,
    };
  }

  private async getGoogleProfile(token: string): Promise<OAuthProfile> {
    const client = new OAuth2Client(this.googleClientId);
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: this.googleClientId,
    });

    const payload = ticket.getPayload();
    if (!payload) throw new UnauthorizedException('Invalid Google token');

    return {
      id: payload.sub,
      email: payload.email!,
      firstName: payload.given_name,
      lastName: payload.family_name,
      avatar: payload.picture,
    };
  }
  catch(err) {
    this.logger.error('Google OAuth error:', err);
    throw new UnauthorizedException('Invalid Google token');
  }

  private async getFacebookProfile(token: string): Promise<OAuthProfile> {
    try {
      const url = `https://graph.facebook.com/me?fields=id,email,first_name,last_name,picture.type(large)&access_token=${token}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.error) throw new UnauthorizedException('Invalid Facebook token');

      return {
        id: data.id,
        email: data.email,
        firstName: data.first_name,
        lastName: data.last_name,
        avatar: data.picture?.data?.url,
      };
    } catch (err) {
      this.logger.error('Facebook OAuth error:', err);
      throw new UnauthorizedException('Invalid Facebook token');
    }
  }

  private async getLinkedInProfile(token: string): Promise<OAuthProfile> {
    try {
      // 1. Get basic profile
      const profileRes = await fetch('https://api.linkedin.com/v2/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const profileData = await profileRes.json();
      if (profileData.status === 401)
        throw new UnauthorizedException('Invalid LinkedIn token');

      // 2. Get email
      const emailRes = await fetch(
        'https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))',
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const emailData = await emailRes.json();

      return {
        id: profileData.id,
        email: emailData.elements[0]['handle~'].emailAddress,
        firstName: profileData.localizedFirstName,
        lastName: profileData.localizedLastName,
        avatar: undefined, // LinkedIn API requires extra permissions for profile picture
      };
    } catch (err) {
      this.logger.error('LinkedIn OAuth error:', err);
      throw new UnauthorizedException('Invalid LinkedIn token');
    }
  }
}
