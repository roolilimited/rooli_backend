import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthenticatedUser } from '../decorators/permissions.decorator';
import { PermissionService } from '@/role-permissions/role-permission.service';

@Injectable()
export class PermissionContextInterceptor implements NestInterceptor {
  constructor(private permissionService: PermissionService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;

    if (user) {
      const organizationId = request.params.organizationId || request.body.organizationId;
      
      if (organizationId) {
        // Load user permissions for this organization
        this.permissionService.getUserPermissions(user.id, organizationId).then(permissions => {
          request.userPermissions = permissions;
        });
      }
    }

    return next.handle().pipe(
      tap(() => {
        // Could log permission checks here
      }),
    );
  }
}