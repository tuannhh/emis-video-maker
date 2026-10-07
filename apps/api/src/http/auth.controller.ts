import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { USER_ROLES } from '@edu/shared';
import { SettingsService } from '../core/settings.service.js';
import { AdminOnly, CurrentUser, Public } from './auth.guard.js';
import { AuthService, type SessionUser } from './auth.service.js';
import { ZodPipe } from './zod.pipe.js';

const Password = z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(200);
const LoginSchema = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });
const ChangePasswordSchema = z.object({ current: z.string().min(1).max(200), next: Password });
const CreateUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ').max(200),
  name: z.string().trim().min(1, 'Nhập họ tên').max(100),
  role: z.enum(USER_ROLES).default('member'),
  password: Password,
});
const UpdateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(USER_ROLES).optional(),
  active: z.boolean().optional(),
  password: Password.optional(),
});
const GeminiKeySchema = z.object({ apiKey: z.string().trim().min(20, 'API key không hợp lệ').max(300) });

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body(new ZodPipe(LoginSchema)) body: z.infer<typeof LoginSchema>, @Res({ passthrough: true }) res: Response) {
    const { user, version } = await this.auth.login(body.email, body.password);
    this.auth.setSession(res, user.id, version);
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    this.auth.clearSession(res);
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return this.auth.me(user.id);
  }

  /** Đổi mật khẩu của chính mình: các thiết bị khác bị đăng xuất, thiết bị này được cấp phiên mới */
  @Put('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(ChangePasswordSchema)) body: z.infer<typeof ChangePasswordSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const version = await this.auth.changePassword(user.id, body.current, body.next);
    this.auth.setSession(res, user.id, version);
  }
}

@AdminOnly()
@Controller('api/users')
export class UsersController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  list() {
    return this.auth.list();
  }

  @Post()
  create(@Body(new ZodPipe(CreateUserSchema)) body: z.infer<typeof CreateUserSchema>) {
    return this.auth.create(body);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: SessionUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateUserSchema)) body: z.infer<typeof UpdateUserSchema>,
  ) {
    return this.auth.update(actor.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() actor: SessionUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.remove(actor.id, id);
  }
}

@AdminOnly()
@Controller('api/settings')
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.info();
  }

  /** Lưu Gemini API key sau khi thử gọi Gemini bằng key đó */
  @Put('gemini-key')
  async setGeminiKey(@CurrentUser() user: SessionUser, @Body(new ZodPipe(GeminiKeySchema)) body: z.infer<typeof GeminiKeySchema>) {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': body.apiKey },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!res) throw new BadRequestException('Không kết nối được Gemini API, thử lại sau');
    if (!res.ok) {
      const detail = ((await res.json().catch(() => null)) as any)?.error?.message ?? `HTTP ${res.status}`;
      throw new BadRequestException(`Gemini từ chối key này: ${String(detail).slice(0, 200)}`);
    }
    await this.settings.setGeminiKey(body.apiKey, user.id);
    return this.settings.info();
  }

  @Delete('gemini-key')
  async clearGeminiKey() {
    await this.settings.clearGeminiKey();
    return this.settings.info();
  }
}
