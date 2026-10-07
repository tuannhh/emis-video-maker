import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { signedGcsUrl } from './gcp.js';
import { sign } from './secure.js';

/** Link GCS ký sẵn: còn hạn 1 giờ, dùng lại trong 45 phút để trình duyệt cache được ảnh */
const SIGNED_TTL_SEC = 3600;
const SIGNED_REUSE_MS = 45 * 60_000;

/**
 * Lưu file trên volume dùng chung giữa api và worker.
 * Key dạng "characters/be-na/base.png"; có thể thay bằng S3 sau này mà không đổi nơi gọi.
 */
@Injectable()
export class StorageService {
  private readonly signed = new Map<string, { url: string; at: number }>();

  resolve(key: string): string {
    const full = path.resolve(config.storageDir, key);
    if (!full.startsWith(config.storageDir + path.sep)) throw new Error(`Key không hợp lệ: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer | Uint8Array): Promise<string> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return key;
  }

  async putFromFile(key: string, sourcePath: string): Promise<string> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.copyFile(sourcePath, full);
    return key;
  }

  read(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async removePrefix(prefix: string) {
    await fs.rm(this.resolve(prefix), { recursive: true, force: true });
  }

  publicUrl(key: string) {
    return `${config.filesPublicUrl}/files/${encodeKey(key)}`;
  }

  /** URL cho renderer (không có cookie đăng nhập): kèm chữ ký của đúng key này */
  internalUrl(key: string) {
    return `${config.filesInternalUrl}/files/${encodeKey(key)}?t=${fileToken(key)}`;
  }

  /** Link tải thẳng từ bucket GCS (null nếu không dùng GCS) */
  async signedUrl(key: string, download?: string): Promise<string | null> {
    if (!config.storageBucket) return null;
    const id = `${key}|${download ?? ''}`;
    const hit = this.signed.get(id);
    if (hit && Date.now() - hit.at < SIGNED_REUSE_MS) return hit.url;
    const disposition = download ? `attachment; filename*=UTF-8''${encodeURIComponent(download)}` : undefined;
    const url = await signedGcsUrl(config.storageBucket, key, SIGNED_TTL_SEC, disposition);
    if (this.signed.size > 5000) this.signed.clear();
    this.signed.set(id, { url, at: Date.now() });
    return url;
  }
}

export function fileToken(key: string) {
  return sign('file', key);
}

function encodeKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}
