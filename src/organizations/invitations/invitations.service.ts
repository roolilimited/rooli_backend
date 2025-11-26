import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InviteMemberDto } from './dtos/invite-member.dto';
import { MailService } from '@/mail/mail.service';
import { PrismaService } from '@/prisma/prisma.service';

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async inviteMember(orgId: string, inviterId: string, dto: InviteMemberDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: {
        organizationMemberships: {
          where: { organizationId: orgId, isActive: true },
        },
      },
    });

    if (existingUser?.organizationMemberships.length > 0) {
      throw new ConflictException(
        'User is already a member of this organization',
      );
    }

    if (!(await this.checkMemberLimit(orgId))) {
      throw new BadRequestException('Organization member limit reached');
    }

    const existingInvitation =
      await this.prisma.organizationInvitation.findFirst({
        where: {
          email: dto.email,
          organizationId: orgId,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      });

    if (existingInvitation) {
      throw new ConflictException(
        'Pending invitation already exists for this email',
      );
    }

    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS);

    const invitation = await this.prisma.organizationInvitation.create({
      data: {
        email: dto.email,
        organizationId: orgId,
        invitedBy: inviterId,
        role: dto.role,
        message: dto.message,
        permissions: dto.permissions,
        token,
        expiresAt,
      },
      include: {
        organization: true,
        inviter: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    await this.mailService.sendInvitationEmail({
      to: dto.email,
      organizationName: invitation.organization.name,
      inviterName: this.formatInviterName(invitation.inviter),
      token,
      role: dto.role,
      message: dto.message,
    });

    await this.logAuditEvent(orgId, inviterId, 'member_invited', {
      email: dto.email,
      role: dto.role,
    });

    return invitation;
  }

  async acceptInvitation(token: string, userId: string) {
    const invitation = await this.prisma.organizationInvitation.findUnique({
      where: { token },
      include: { organization: true },
    });

    if (!invitation || invitation.expiresAt < new Date()) {
      throw new NotFoundException('Invalid or expired invitation');
    }

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('Invitation has already been processed');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.email !== invitation.email) {
      throw new BadRequestException(
        'Invitation email does not match user email',
      );
    }

    if (!(await this.checkMemberLimit(invitation.organizationId))) {
      throw new BadRequestException('Organization member limit reached');
    }

    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.organizationMember.create({
        data: {
          organizationId: invitation.organizationId,
          userId,
          roleId: invitation.role,
          invitedBy: invitation.invitedBy,
          permissions: invitation.permissions,
        },
      });

      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });

      await this.logAuditEvent(
        invitation.organizationId,
        userId,
        'member_joined',
        {
          invitationId: invitation.id,
          role: invitation.role,
        },
      );

      return membership;
    });
  }

  async resendInvitation(invitationId: string, inviterId: string) {
    const invitation = await this.prisma.organizationInvitation.findUnique({
      where: { id: invitationId },
      include: { organization: true, inviter: true },
    });

    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('Cannot resend a processed invitation');
    }

    const newToken = this.generateToken();
    const newExpiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS);

    const updatedInvitation = await this.prisma.organizationInvitation.update({
      where: { id: invitationId },
      data: {
        token: newToken,
        expiresAt: newExpiresAt,
        resentAt: new Date(),
      },
    });

    await this.mailService.sendInvitationEmail({
      to: invitation.email,
      organizationName: invitation.organization.name,
      inviterName: this.formatInviterName(invitation.inviter),
      token: newToken,
      role: invitation.role,
      message: invitation.message,
    });

    await this.logAuditEvent(
      invitation.organizationId,
      inviterId,
      'invitation_resent',
      {
        invitationId,
        email: invitation.email,
      },
    );

    return updatedInvitation;
  }

  async revokeInvitation(invitationId: string, revokerId: string) {
    const invitation = await this.prisma.organizationInvitation.findUnique({
      where: { id: invitationId },
      include: { organization: true },
    });

    if (!invitation) throw new NotFoundException('Invitation not found');

    const updatedInvitation = await this.prisma.organizationInvitation.update({
      where: { id: invitationId },
      data: { status: 'REVOKED' },
    });

    await this.logAuditEvent(
      invitation.organizationId,
      revokerId,
      'invitation_revoked',
      {
        invitationId: invitation.id,
        email: invitation.email,
      },
    );

    return updatedInvitation;
  }

  async getOrganizationInvitations(orgId: string) {
    return this.prisma.organizationInvitation.findMany({
      where: { organizationId: orgId },
      include: {
        inviter: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async checkMemberLimit(orgId: string): Promise<boolean> {
    const [organization, memberCount] = await this.prisma.$transaction([
      this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { maxMembers: true },
      }),
      this.prisma.organizationMember.count({
        where: { organizationId: orgId, isActive: true },
      }),
    ]);

    return memberCount < (organization?.maxMembers ?? 0);
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private formatInviterName(inviter: {
    firstName?: string;
    lastName?: string;
  }) {
    return `${inviter?.firstName ?? ''} ${inviter?.lastName ?? ''}`.trim();
  }

  private async logAuditEvent(
    orgId: string,
    userId: string,
    action: string,
    details: any,
  ) {
    await this.prisma.auditLog.create({
      data: {
        organizationId: orgId,
        userId,
        action,
        resourceType: 'organization',
        details,
      },
    });
  }
}
