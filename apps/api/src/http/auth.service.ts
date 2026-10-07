import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { UserRole, UserView } from '@edu/shared';
import { config } from '../core/config.js';
import { DbService } from '../core/db.service.js';
import { hashPassword, sign, verifyPassword, verifySignature } from '../core/secure.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export const SESSION_COOKIE = 'emis_session';
const SESSION_DAYS = 14;

function toView(r: any): UserView {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    active: r.active,
    lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

function cookieOf(req: Request, name: string) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Chặn dò mật khẩu: sai 5 lần trong 15 phút thì khoá đăng nhập email đó 15 phút */
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60_000;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly fails = new Map<string, { count: number; first: number }>();

  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Tạo admin đầu tiên từ ADMIN_EMAIL / ADMIN_PASSWORD (không đổi mật khẩu nếu tài khoản đã có) */
  async onModuleInit() {
    await this.db.migrated();
    const { email, password } = config.admin;
    if (!email || !password) {
      const n = await this.db.one(`select count(*)::int as n from users where role = 'admin'`);
      if (!n?.n) this.logger.warn('Chưa có tài khoản admin: đặt ADMIN_EMAIL và ADMIN_PASSWORD rồi khởi động lại');
      return;
    }
    const created = await this.db.one(
      `insert into users (email, name, role, password_hash) values ($1, $2, 'admin', $3)
       on conflict (email) do nothing returning id`,
      [email, email.split('@')[0], await hashPassword(password)],
    );
    if (created) this.logger.log(`Đã tạo tài khoản admin ${email}`);
  }

  // ---------- Phiên đăng nhập: cookie "<userId>.<sessionVersion>.<hết hạn>.<chữ ký>" ----------

  private token(userId: string, version: number) {
    const value = `${userId}.${version}.${Date.now() + SESSION_DAYS * 86_400_000}`;
    return `${value}.${sign('session', value)}`;
  }

  setSession(res: Response, userId: string, version: number) {
    res.cookie(SESSION_COOKIE, this.token(userId, version), {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: SESSION_DAYS * 86_400_000,
    });
  }

  clearSession(res: Response) {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' });
  }

  /** Người dùng của request (null nếu chưa đăng nhập, phiên hết hạn hoặc đã bị thu hồi) */
  async userFromRequest(req: Request): Promise<SessionUser | null> {
    const raw = cookieOf(req, SESSION_COOKIE);
    if (!raw) return null;
    const parts = raw.split('.');
    if (parts.length !== 4) return null;
    const [id, version, expires, signature] = parts;
    if (!verifySignature('session', `${id}.${version}.${expires}`, signature)) return null;
    if (Number(expires) < Date.now() || !/^[0-9a-f-]{36}$/.test(id)) return null;
    const row = await this.db.one(
      'select id, email, name, role from users where id = $1 and active and session_version = $2',
      [id, Number(version)],
    );
    return row ? { id: row.id, email: row.email, name: row.name, role: row.role } : null;
  }

  async login(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const f = this.fails.get(email);
    if (f && Date.now() - f.first < WINDOW_MS && f.count >= MAX_FAILS) {
      throw new BadRequestException('Đăng nhập sai quá nhiều lần, thử lại sau 15 phút');
    }
    const row = await this.db.one('select * from users where email = $1', [email]);
    const ok = row && row.active && (await verifyPassword(password, row.password_hash));
    if (!ok) {
      const cur = f && Date.now() - f.first < WINDOW_MS ? f : { count: 0, first: Date.now() };
      cur.count++;
      this.fails.set(email, cur);
      throw new BadRequestException(row && !row.active ? 'Tài khoản đã bị khoá' : 'Email hoặc mật khẩu không đúng');
    }
    this.fails.delete(email);
    await this.db.query('update users set last_login_at = now() where id = $1', [row.id]);
    return { user: toView(row), version: row.session_version as number };
  }

  async changePassword(userId: string, current: string, next: string) {
    const row = await this.db.one('select password_hash from users where id = $1', [userId]);
    if (!row || !(await verifyPassword(current, row.password_hash))) {
      throw new BadRequestException('Mật khẩu hiện tại không đúng');
    }
    return this.setPassword(userId, next);
  }

  /** Đặt mật khẩu mới và thu hồi mọi phiên cũ; trả về phiên bản mới để cấp lại cookie cho chính người đổi */
  async setPassword(userId: string, password: string) {
    const row = await this.db.one(
      'update users set password_hash = $2, session_version = session_version + 1 where id = $1 returning session_version',
      [userId, await hashPassword(password)],
    );
    if (!row) throw new NotFoundException('Không tìm thấy thành viên');
    return row.session_version as number;
  }

  // ---------- Quản lý thành viên (admin) ----------

  async list(): Promise<UserView[]> {
    const rows = await this.db.query('select * from users order by role, created_at');
    return rows.map(toView);
  }

  async me(id: string): Promise<UserView> {
    const row = await this.db.one('select * from users where id = $1', [id]);
    if (!row) throw new NotFoundException('Không tìm thấy thành viên');
    return toView(row);
  }

  async create(input: { email: string; name: string; role: UserRole; password: string }): Promise<UserView> {
    try {
      const row = await this.db.one(
        `insert into users (email, name, role, password_hash) values ($1, $2, $3, $4) returning *`,
        [input.email.trim().toLowerCase(), input.name.trim(), input.role, await hashPassword(input.password)],
      );
      return toView(row);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ConflictException('Email này đã có tài khoản');
      throw err;
    }
  }

  async update(actorId: string, id: string, patch: { name?: string; role?: UserRole; active?: boolean; password?: string }) {
    const target = await this.me(id);
    if (id === actorId && (patch.role === 'member' || patch.active === false)) {
      throw new BadRequestException('Không thể tự hạ quyền hoặc tự khoá tài khoản của mình');
    }
    if (target.role === 'admin' && (patch.role === 'member' || patch.active === false)) await this.keepOneAdmin(id);
    if (patch.name !== undefined || patch.role !== undefined) {
      await this.db.query('update users set name = coalesce($2, name), role = coalesce($3, role) where id = $1', [
        id,
        patch.name?.trim() ?? null,
        patch.role ?? null,
      ]);
    }
    if (patch.active !== undefined) {
      // Khoá tài khoản thì đăng xuất ngay mọi phiên
      await this.db.query('update users set active = $2, session_version = session_version + 1 where id = $1', [
        id,
        patch.active,
      ]);
    }
    if (patch.password) await this.setPassword(id, patch.password);
    return this.me(id);
  }

  async remove(actorId: string, id: string) {
    if (id === actorId) throw new BadRequestException('Không thể tự xoá tài khoản của mình');
    const target = await this.me(id);
    if (target.role === 'admin') await this.keepOneAdmin(id);
    // Bài học của người này vẫn giữ lại (người tạo để trống)
    await this.db.query('delete from users where id = $1', [id]);
  }

  private async keepOneAdmin(exceptId: string) {
    const r = await this.db.one(`select count(*)::int as n from users where role = 'admin' and active and id <> $1`, [exceptId]);
    if (!r?.n) throw new BadRequestException('Phải còn ít nhất một admin đang hoạt động');
  }
}
