import crypto from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Part } from '@google/genai';
import sharp from 'sharp';
import { z } from 'zod';
import { VOICE_IDS, VOICES, type Asset, type CharacterPreview } from '@edu/shared';
import { AssetsRepo } from '../core/assets.repo.js';
import { DbService } from '../core/db.service.js';
import { BLOCKED_MESSAGE, GeminiError, GeminiService } from '../core/gemini.service.js';
import { StorageService } from '../core/storage.service.js';
import { UploadsService } from '../core/uploads.service.js';
import { usageContext } from '../core/usage.service.js';
import { cutoutVariants } from '../pipeline/chroma.js';
import {
  DESCRIBE_CHARACTER_PROMPT,
  MASCOT_PREP_PROMPT,
  characterPrompt,
  designCharacterPrompt,
  suggestCharacterPrompt,
} from '../pipeline/prompts.js';

const ROLES = ['child', 'adult', 'mascot'] as const;
const DesignSchema = z.object({
  suggestedName: z.string(),
  description: z.string(),
  role: z.enum(ROLES),
  voice: z.enum(VOICE_IDS),
});

interface PreviewMeta {
  mode: 'mascot' | 'design';
  description: string;
  suggestedName: string;
  role: (typeof ROLES)[number];
  voice: string;
  cutoutKey: string;
  originalKey?: string;
  style?: string;
}

/** Chữ thường không dấu nối gạch ngang: "Robot Bíp" → "robot-bip" */
function slugify(s: string) {
  return (
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'nhan-vat'
  );
}

const inline = (data: Buffer): Part => ({ inlineData: { mimeType: 'image/png', data: data.toString('base64') } });

/** Ảnh tải lên → PNG cỡ vừa phải để gửi cho model ảnh */
const toPng = (data: Buffer) =>
  sharp(data).resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer();

/**
 * Tạo nhân vật cho thư viện (ngoài quy trình sản xuất bài học): tải mascot có sẵn hoặc nhờ AI thiết kế từ ảnh tham chiếu + yêu cầu.
 * Chỉ vẽ một ảnh dáng đứng để xem trước; các dáng tay, khẩu hình được dựng khi nhân vật được dùng lần đầu.
 */
@Injectable()
export class CharactersService {
  constructor(
    @Inject(GeminiService) private readonly gemini: GeminiService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(UploadsService) private readonly uploads: UploadsService,
    @Inject(AssetsRepo) private readonly repo: AssetsRepo,
    @Inject(DbService) private readonly db: DbService,
  ) {}

  /** Tính chi phí vào mục "Tạo nhân vật (thư viện)"; lỗi AI trả về thông báo dễ hiểu thay vì lỗi 500 */
  private async library<T>(fn: () => Promise<T>) {
    try {
      return await usageContext.run({ lessonId: null, step: 'library' }, fn);
    } catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      throw new UnprocessableEntityException(
        e.message.includes(BLOCKED_MESSAGE) || /\((SAFETY|PROHIBITED_CONTENT|IMAGE_SAFETY|OTHER)\)/.test(e.message)
          ? 'AI từ chối yêu cầu này (bộ lọc an toàn của Gemini). Hãy thử lại hoặc diễn đạt yêu cầu ngắn gọn hơn.'
          : `AI đang lỗi, hãy thử lại sau ít phút (${e.message})`,
      );
    }
  }

  /** AI gợi ý câu yêu cầu tạo nhân vật (dựa trên ảnh tham chiếu và bài học nếu có) */
  suggest(input: { referenceId?: string; draft?: string; topic?: string; subject?: string; grade?: string }) {
    return this.library(async () => {
      const parts: Part[] = [];
      if (input.referenceId) parts.push(inline(await toPng((await this.uploads.image(input.referenceId, ['reference', 'mascot'])).data)));
      parts.push({ text: suggestCharacterPrompt(input, !!input.referenceId) });
      return { prompt: await this.gemini.text('Gợi ý nhân vật', parts, { temperature: 0.9 }) };
    });
  }

  async preview(
    input: { mode: 'mascot'; uploadId: string } | { mode: 'design'; prompt: string; referenceId?: string; styleId?: string },
    userId: string,
  ): Promise<CharacterPreview> {
    return this.library(async () => {
      let drawn: Buffer;
      let design: z.infer<typeof DesignSchema>;
      let originalKey: string | undefined;
      let style: string | undefined;

      if (input.mode === 'mascot') {
        const upload = await this.uploads.image(input.uploadId, ['mascot']);
        const img = await toPng(upload.data);
        originalKey = await this.fileKey(input.uploadId);
        const describe =
          `${DESCRIBE_CHARACTER_PROMPT}\nTrả về JSON: description = đoạn mô tả tiếng Anh ở trên; suggestedName = tên tiếng Việt ngắn cho ` +
          `mascot (nếu ảnh có ghi tên thì dùng tên đó); role = "mascot"; voice = giọng hợp nhất:\n` +
          VOICES.map((v) => `- ${v.id}: ${v.tone} (hợp với ${v.suits})`).join('\n');
        [drawn, design] = await Promise.all([
          this.gemini.image('Chuẩn bị mascot', MASCOT_PREP_PROMPT, { aspectRatio: '3:4', images: [img] }),
          this.gemini.json('Mô tả mascot', DesignSchema, [inline(img), { text: describe }], { temperature: 0.2 }),
        ]);
      } else {
        const ref = input.referenceId ? await toPng((await this.uploads.image(input.referenceId, ['reference', 'mascot'])).data) : null;
        const styleImg = input.styleId ? await toPng((await this.uploads.image(input.styleId, ['style'])).data) : null;
        if (styleImg) style = `s${input.styleId!.replace(/-/g, '').slice(0, 6)}`;
        design = await this.gemini.json(
          'Thiết kế nhân vật',
          DesignSchema,
          [...(ref ? [inline(ref)] : []), { text: designCharacterPrompt(input.prompt, !!ref) }],
          { temperature: 0.7 },
        );
        const prompt =
          characterPrompt(design.description, !!styleImg) +
          (ref ? '\nThe FIRST attached image is a CHARACTER REFERENCE: base the character on it, applying the description above.' : '');
        drawn = await this.gemini.image(`Vẽ nhân vật ${design.suggestedName}`, prompt, {
          aspectRatio: '3:4',
          images: [...(ref ? [ref] : []), ...(styleImg ? [styleImg] : [])],
        });
      }

      const source = await sharp(drawn).png().toBuffer();
      const cut = await cutoutVariants([source], 1200);
      const id = crypto.randomUUID();
      const sourceKey = await this.storage.put(`previews/${id}/source.png`, source);
      const cutoutKey = await this.storage.put(`previews/${id}/cutout.png`, cut.images[0]);
      const meta: PreviewMeta = {
        mode: input.mode,
        description: design.description,
        suggestedName: design.suggestedName,
        role: input.mode === 'mascot' ? 'mascot' : design.role,
        voice: design.voice,
        cutoutKey,
        originalKey,
        style,
      };
      await this.db.query(
        `insert into uploads (id, kind, name, mime, size, file_key, text, created_by) values ($1, 'preview', $2, 'image/png', $3, $4, $5, $6)`,
        [id, design.suggestedName.slice(0, 120), source.length, sourceKey, JSON.stringify(meta), userId],
      );
      return {
        previewId: id,
        url: this.storage.publicUrl(cutoutKey),
        description: design.description,
        suggestedName: design.suggestedName,
        suggestedRole: meta.role,
        suggestedVoice: design.voice,
        mode: input.mode,
      };
    });
  }

  private async fileKey(uploadId: string) {
    const row = await this.db.one('select file_key from uploads where id = $1', [uploadId]);
    return row?.file_key as string | undefined;
  }

  /** Lưu bản xem trước vào thư viện */
  async create(input: { previewId: string; name: string; voice: string; role: (typeof ROLES)[number]; description?: string }): Promise<Asset> {
    const row = await this.db.one(`select * from uploads where id = $1 and kind = 'preview'`, [input.previewId]);
    if (!row) throw new NotFoundException('Bản xem trước không còn, hãy tạo lại');
    const meta = JSON.parse(row.text) as PreviewMeta;
    if (!(VOICE_IDS as readonly string[]).includes(input.voice)) throw new BadRequestException('Giọng đọc không hợp lệ');

    let key = '';
    for (let i = 0; i < 5; i++) {
      key = `${slugify(input.name)}-${crypto.randomBytes(2).toString('hex')}`;
      if (!(await this.repo.get('character', key))) break;
    }
    const dir = `characters/${key}/${Date.now()}`;
    const source = await this.storage.read(row.file_key);
    const cutout = await this.storage.read(meta.cutoutKey);
    const size = await sharp(cutout).metadata();
    const files: Record<string, string> = {
      source: await this.storage.put(`${dir}/source.png`, source),
      // Ảnh đã tách nền để hiển thị trong thư viện; bộ dáng đầy đủ được dựng khi dùng lần đầu
      idle: await this.storage.put(`${dir}/preview.png`, cutout),
    };
    if (meta.originalKey && (await this.storage.exists(meta.originalKey))) {
      files.original = await this.storage.put(`${dir}/original${meta.originalKey.slice(meta.originalKey.lastIndexOf('.'))}`, await this.storage.read(meta.originalKey));
    }
    const asset = await this.repo.upsert({
      kind: 'character',
      key,
      name: input.name.trim(),
      description: (input.description ?? meta.description).trim(),
      files,
      meta: {
        width: size.width,
        height: size.height,
        voice: input.voice,
        role: input.role,
        rig: 0,
        ready: true,
        origin: meta.mode === 'mascot' ? 'upload' : 'ai',
        facing: meta.mode === 'mascot' ? 'front' : 'right',
        style: meta.style,
      },
    });
    await this.db.query('delete from uploads where id = $1', [input.previewId]);
    await this.storage.removePrefix(`previews/${input.previewId}`);
    return asset;
  }
}
