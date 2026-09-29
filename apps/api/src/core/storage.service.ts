import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

/**
 * Lưu file trên volume dùng chung giữa api và worker.
 * Key dạng "characters/be-na/base.png"; có thể thay bằng S3 sau này mà không đổi nơi gọi.
 */
@Injectable()
export class StorageService {
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

  internalUrl(key: string) {
    return `${config.filesInternalUrl}/files/${encodeKey(key)}`;
  }
}

function encodeKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}
