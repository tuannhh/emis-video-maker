import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SystemSettings } from '@edu/shared';
import { config } from './config.js';
import { DbService } from './db.service.js';
import { decrypt, encrypt } from './secure.js';

const GEMINI_KEY = 'gemini_api_key';
/** Api và worker chạy ở tiến trình khác nhau: đọc lại key từ DB sau chừng này ms */
const CACHE_MS = 30_000;

/**
 * Cấu hình hệ thống do admin nhập. Gemini API key được mã hoá AES-256-GCM (khoá dẫn xuất từ APP_SECRET),
 * không bao giờ trả nguyên văn ra ngoài, chỉ 4 ký tự cuối.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cached: { key: string; source: 'db' | 'env' | null; at: number } | null = null;

  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Key đang dùng: key admin nhập trên trang Cài đặt, không có thì lấy GEMINI_API_KEY */
  async geminiKey(): Promise<string> {
    return (await this.current()).key;
  }

  private async current() {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached;
    await this.db.migrated();
    const row = await this.db.one('select value from settings where key = $1', [GEMINI_KEY]);
    let key = '';
    let source: 'db' | 'env' | null = null;
    if (row?.value?.sealed) {
      try {
        key = decrypt(row.value.sealed);
        source = 'db';
      } catch {
        this.logger.error('Không giải mã được Gemini API key (APP_SECRET đã đổi?) — admin cần nhập lại key');
      }
    }
    if (!key && config.gemini.apiKey) {
      key = config.gemini.apiKey;
      source = 'env';
    }
    this.cached = { key, source, at: Date.now() };
    return this.cached;
  }

  async info(): Promise<SystemSettings> {
    this.cached = null;
    const { key, source } = await this.current();
    const row = await this.db.one(
      `select s.updated_at, u.name from settings s left join users u on u.id = s.updated_by where s.key = $1`,
      [GEMINI_KEY],
    );
    const fromDb = source === 'db';
    return {
      gemini: {
        configured: !!key,
        source,
        last4: key ? key.slice(-4) : null,
        updatedAt: fromDb && row ? row.updated_at.toISOString() : null,
        updatedBy: fromDb && row ? row.name : null,
      },
    };
  }

  async setGeminiKey(apiKey: string, userId: string) {
    await this.db.query(
      `insert into settings (key, value, updated_by, updated_at) values ($1, $2, $3, now())
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
      [GEMINI_KEY, JSON.stringify({ sealed: encrypt(apiKey) }), userId],
    );
    this.cached = null;
  }

  async clearGeminiKey() {
    await this.db.query('delete from settings where key = $1', [GEMINI_KEY]);
    this.cached = null;
  }
}
