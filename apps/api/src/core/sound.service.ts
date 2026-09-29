import crypto from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SFX, SFX_IDS, slugify, type Asset, type SfxId } from '@edu/shared';
import { musicPrompt } from '../pipeline/prompts.js';
import { SFX_VERSION, synthesizeSfx } from '../pipeline/sfx.js';
import { AssetsRepo } from './assets.repo.js';
import { GeminiService } from './gemini.service.js';
import { StorageService } from './storage.service.js';

const AUDIO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
};

export function audioExt(mime: string) {
  return AUDIO_EXT[mime.toLowerCase()] ?? null;
}

/** Nhạc nền và hiệu ứng âm thanh: tự tổng hợp, AI sáng tác, hoặc người dùng tải lên. */
@Injectable()
export class SoundService {
  private readonly logger = new Logger(SoundService.name);

  constructor(
    @Inject(AssetsRepo) private readonly repo: AssetsRepo,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(GeminiService) private readonly gemini: GeminiService,
  ) {}

  /** Storage key của từng hiệu ứng: file người dùng thay thế nếu có, không thì bản tổng hợp sẵn. */
  async sfxKeys(): Promise<Record<SfxId, string>> {
    const overrides = new Map((await this.repo.list('sfx')).map((a) => [a.key, a.files.audio]));
    const out = {} as Record<SfxId, string>;
    for (const id of SFX_IDS) {
      const custom = overrides.get(id);
      if (custom && (await this.storage.exists(custom))) {
        out[id] = custom;
        continue;
      }
      const key = `sfx/builtin-v${SFX_VERSION}/${id}.wav`;
      if (!(await this.storage.exists(key))) await this.storage.put(key, synthesizeSfx(id));
      out[id] = key;
    }
    return out;
  }

  async listSfx() {
    const keys = await this.sfxKeys();
    const overrides = new Map((await this.repo.list('sfx')).map((a) => [a.key, a]));
    return SFX_IDS.map((id) => ({
      id,
      description: SFX[id],
      url: this.storage.publicUrl(keys[id]),
      custom: overrides.get(id) ?? null,
    }));
  }

  /** Thay một hiệu ứng bằng file của người dùng */
  async uploadSfx(id: SfxId, data: Buffer, mime: string, fileName: string) {
    const ext = audioExt(mime);
    if (!ext) throw new Error('Định dạng âm thanh chưa hỗ trợ');
    const key = await this.storage.put(`sfx/custom/${id}-${Date.now()}.${ext}`, data);
    return this.repo.upsert({
      kind: 'sfx',
      key: id,
      name: fileName || id,
      description: SFX[id],
      files: { audio: key },
      meta: { source: 'upload', mimeType: mime },
    });
  }

  async uploadMusic(data: Buffer, mime: string, name: string) {
    const ext = audioExt(mime);
    if (!ext) throw new Error('Định dạng âm thanh chưa hỗ trợ');
    const id = crypto.randomBytes(3).toString('hex');
    const key = await this.storage.put(`music/${slugify(name, 'nhac')}-${id}.${ext}`, data);
    const hasDefault = (await this.repo.list('music')).some((m) => m.meta.isDefault);
    return this.repo.upsert({
      kind: 'music',
      key: `${slugify(name, 'nhac')}-${id}`,
      name: name || 'Nhạc tải lên',
      description: 'Người dùng tải lên',
      files: { audio: key },
      meta: { source: 'upload', mimeType: mime, isDefault: !hasDefault },
    });
  }

  /** AI (Lyria) sáng tác một bản nhạc nền và lưu vào thư viện */
  async generateMusic(name: string, subject: string, style?: string) {
    const prompt = musicPrompt(subject, style);
    const { audio, mimeType } = await this.gemini.music('Sáng tác nhạc nền', prompt);
    const ext = audioExt(mimeType) ?? 'mp3';
    const id = crypto.randomBytes(3).toString('hex');
    const key = await this.storage.put(`music/${slugify(name, 'nhac')}-${id}.${ext}`, audio);
    const hasDefault = (await this.repo.list('music')).some((m) => m.meta.isDefault);
    this.logger.log(`Đã sáng tác nhạc nền "${name}"`);
    return this.repo.upsert({
      kind: 'music',
      key: `${slugify(name, 'nhac')}-${id}`,
      name,
      description: style ? `AI sáng tác: ${style}` : 'AI sáng tác',
      files: { audio: key },
      meta: { source: 'ai', mimeType, prompt, isDefault: !hasDefault },
    });
  }

  async setDefaultMusic(id: string) {
    for (const m of await this.repo.list('music')) {
      const isDefault = m.id === id;
      if (!!m.meta.isDefault !== isDefault) await this.repo.updateMeta(m.id, { ...m.meta, isDefault });
    }
  }

  /**
   * Nhạc cho bài học. 'auto' = bản mặc định trong thư viện; thư viện trống thì AI sáng tác một bản
   * và đặt làm mặc định để các bài sau dùng lại (không tốn thêm token).
   */
  async resolveMusic(musicId: string | null | undefined, subject: string): Promise<Asset | null> {
    if (musicId === null) return null;
    if (musicId && musicId !== 'auto') {
      const a = await this.repo.getById(musicId);
      if (a?.kind === 'music') return a;
    }
    const all = await this.repo.list('music');
    const pick = all.find((m) => m.meta.isDefault) ?? all[0];
    if (pick) return pick;
    try {
      return await this.generateMusic('Nhạc nền vui tươi', subject);
    } catch (err) {
      this.logger.warn(`Không sáng tác được nhạc nền, render không có nhạc: ${(err as Error).message}`);
      return null;
    }
  }
}
