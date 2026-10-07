import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { config } from './config.js';

const MIGRATION = /* sql */ `
create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  idea jsonb not null,
  status text not null,
  step text,
  progress int not null default 0,
  error text,
  script jsonb,
  storyboard jsonb,
  output jsonb,
  qa jsonb,
  feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lesson_events (
  id bigserial primary key,
  lesson_id uuid not null references lessons(id) on delete cascade,
  type text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists lesson_events_lesson_idx on lesson_events (lesson_id, id);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  key text not null,
  name text not null,
  description text not null,
  files jsonb not null default '{}',
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (kind, key)
);

create table if not exists tts_cache (
  hash text primary key,
  file_key text not null,
  duration_ms int not null,
  mouth text not null,
  created_at timestamptz not null default now()
);
alter table tts_cache add column if not exists level text;

alter table lessons add column if not exists code text;
alter table lessons add column if not exists audio jsonb;
update lessons set code = substr(md5(random()::text || id::text), 1, 6) where code is null;
create unique index if not exists lessons_code_idx on lessons (code);

-- Token Gemini đã dùng, để tính chi phí. Xoá bài học vẫn giữ lại số liệu (lesson_id = null).
create table if not exists gemini_usage (
  id bigserial primary key,
  lesson_id uuid references lessons(id) on delete set null,
  step text not null default 'other',
  label text not null,
  model text not null,
  prompt_tokens int not null default 0,
  output_tokens int not null default 0,
  thoughts_tokens int not null default 0,
  cached_tokens int not null default 0,
  total_tokens int not null default 0,
  input_detail jsonb not null default '{}',
  output_detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists gemini_usage_lesson_idx on gemini_usage (lesson_id);

-- Tài khoản. session_version tăng khi đổi mật khẩu / khoá tài khoản để đăng xuất mọi phiên cũ.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null default 'member',
  password_hash text not null,
  active boolean not null default true,
  session_version int not null default 1,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
alter table lessons add column if not exists created_by uuid references users(id) on delete set null;

-- Cấu hình hệ thống (giá trị nhạy cảm được mã hoá trước khi lưu)
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
`;

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  readonly pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

  private migration: Promise<void> | null = null;

  async onModuleInit() {
    await this.migrated();
  }

  /** Chờ migrate xong (dịch vụ khác có thể gọi trong onModuleInit của mình, chạy song song với hàm trên) */
  migrated() {
    this.migration ??= this.migrate();
    return this.migration;
  }

  private async migrate() {
    // Nhiều tiến trình (api, worker, job) có thể cùng khởi động: khoá để migrate một lần
    const client = await this.pool.connect();
    try {
      await client.query('select pg_advisory_lock(7342001)');
      await client.query(MIGRATION);
    } finally {
      await client.query('select pg_advisory_unlock(7342001)');
      client.release();
    }
    this.logger.log('Database sẵn sàng');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
    const res = await this.pool.query<T>(text, params);
    return res.rows;
  }

  async one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }
}
