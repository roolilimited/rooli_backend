import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT } from '../decorators/rate-limit.decorator';
import { RateLimitService } from '@/rate-limit/rate-limit.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<string>(
      RATE_LIMIT,
      context.getHandler(),
    );
    if (!action) return true; // no limit set → allow

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    const organizationId = request.user?.organizationId;

    if (!userId) return true; // optionally handle unauthenticated users

    try {
      // await this.rateLimitService.checkLimit(
      //   'AI', // you can pass platform or action type here
      //   userId,
      //   action,
      // );
      return true;
    } catch (err: any) {
      throw new HttpException('Rate limit check failed', 429);
    }
  }
}
