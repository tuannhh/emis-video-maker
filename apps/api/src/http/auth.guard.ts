import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, type SessionUser } from './auth.service.js';

const PUBLIC = 'auth:public';
const ADMIN = 'auth:admin';

/** Không cần đăng nhập (vẫn nhận diện người dùng nếu có cookie) */
export const Public = () => SetMetadata(PUBLIC, true);
/** Chỉ admin: cấu hình hệ thống, API key, báo cáo chi phí, thành viên */
export const AdminOnly = () => SetMetadata(ADMIN, true);

export type AuthedRequest = Request & { user?: SessionUser | null };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user ?? null;
});

/** Mặc định mọi route đều phải đăng nhập */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    req.user = await this.auth.userFromRequest(req);
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    if (!req.user) throw new UnauthorizedException('Vui lòng đăng nhập');
    if (this.reflector.getAllAndOverride<boolean>(ADMIN, targets) && req.user.role !== 'admin') {
      throw new ForbiddenException('Chỉ admin mới có quyền này');
    }
    return true;
  }
}
