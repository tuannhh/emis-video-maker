import crypto from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Part } from '@google/genai';
import {
  DOCX_MIME,
  IMAGE_MIMES,
  MATERIAL_MIMES,
  MAX_IMAGE_BYTES,
  MAX_MATERIAL_BYTES,
  PDF_MIME,
  type UploadKind,
  type UploadView,
} from '@edu/shared';
import { DbService } from './db.service.js';
import { readDocx } from './docx.js';
import { GeminiService } from './gemini.service.js';
import { StorageService } from './storage.service.js';
import { usageContext } from './usage.service.js';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  [PDF_MIME]: 'pdf',
  [DOCX_MIME]: 'docx',
};

/** Nội dung tối đa lưu cho một tư liệu (ký tự) */
const MAX_TEXT = 60_000;
/** Số ảnh nhúng trong file Word tối đa đưa cho AI đọc */
const MAX_DOCX_IMAGES = 8;

const OCR_SYSTEM = `Bạn đọc tư liệu giảng dạy do giáo viên cung cấp để làm nguồn soạn video bài học.
- Chép lại ĐẦY ĐỦ chữ trong tư liệu theo đúng thứ tự (OCR), giữ cấu trúc tiêu đề, danh sách, bảng (dạng markdown), công thức.
- Với hình minh hoạ, sơ đồ, biểu đồ: mô tả ngắn nội dung trong ngoặc vuông, ví dụ [Hình: 3 quả táo trên đĩa].
- Không tóm tắt, không thêm kiến thức ngoài tư liệu, không bình luận. Chữ viết tay khó đọc thì ghi [không rõ].`;

/** Nhận diện loại file theo nội dung (không tin hoàn toàn Content-Type do trình duyệt gửi) */
function sniff(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (data.subarray(0, 5).toString('ascii') === '%PDF-') return PDF_MIME;
  if (data[0] === 0x50 && data[1] === 0x4b) return DOCX_MIME; // zip: kiểm tra kỹ hơn khi đọc
  if (data.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'application/msword';
  return null;
}

function toView(r: any, url: string): UploadView {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    mime: r.mime,
    size: r.size,
    url,
    createdAt: r.created_at.toISOString(),
    textLength: r.text === null ? null : r.text.length,
  };
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(GeminiService) private readonly gemini: GeminiService,
  ) {}

  async create(kind: UploadKind, name: string, data: Buffer, userId: string): Promise<UploadView> {
    const mime = sniff(data);
    if (mime === 'application/msword') throw new BadRequestException('File Word .doc cũ chưa hỗ trợ: hãy lưu lại thành .docx hoặc PDF');
    const allowed: readonly string[] = kind === 'material' ? MATERIAL_MIMES : IMAGE_MIMES;
    if (!mime || !allowed.includes(mime)) {
      throw new BadRequestException(
        kind === 'material' ? 'Chỉ nhận ảnh (PNG, JPG, WEBP), file Word (.docx) hoặc PDF' : 'Chỉ nhận ảnh PNG, JPG hoặc WEBP',
      );
    }
    const limit = kind === 'material' ? MAX_MATERIAL_BYTES : MAX_IMAGE_BYTES;
    if (data.length > limit) throw new BadRequestException(`Tệp vượt quá ${limit / 1024 / 1024}MB`);
    if (mime === DOCX_MIME) {
      try {
        readDocx(data);
      } catch {
        throw new BadRequestException('Không đọc được file Word (.docx), hãy kiểm tra lại file');
      }
    }

    const id = crypto.randomUUID();
    const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 120) || `tep.${EXT[mime]}`;
    const key = await this.storage.put(`uploads/${id}/file.${EXT[mime]}`, data);
    const row = await this.db.one(
      `insert into uploads (id, kind, name, mime, size, file_key, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [id, kind, clean, mime, data.length, key, userId],
    );
    return toView(row, this.storage.publicUrl(key));
  }

  private async row(id: string) {
    const row = await this.db.one('select * from uploads where id = $1', [id]);
    if (!row) throw new NotFoundException('Không tìm thấy tệp đã tải lên');
    return row;
  }

  async list(ids: string[]): Promise<UploadView[]> {
    if (!ids.length) return [];
    const rows = await this.db.query('select * from uploads where id = any($1::uuid[])', [ids]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.filter((id) => byId.has(id)).map((id) => toView(byId.get(id), this.storage.publicUrl(byId.get(id).file_key)));
  }

  /** Ảnh đã tải lên (phong cách, tham chiếu, mascot) */
  async image(id: string, kinds: UploadKind[]): Promise<{ data: Buffer; mime: string }> {
    const row = await this.row(id);
    if (!kinds.includes(row.kind) || !(IMAGE_MIMES as readonly string[]).includes(row.mime)) {
      throw new BadRequestException('Tệp này không phải ảnh phù hợp');
    }
    return { data: await this.storage.read(row.file_key), mime: row.mime };
  }

  /** Nội dung tư liệu (AI đọc một lần, lưu lại để viết lại kịch bản không tốn thêm) */
  async materials(ids: string[]): Promise<{ name: string; text: string }[]> {
    const out: { name: string; text: string }[] = [];
    for (const id of ids) {
      const row = await this.db.one('select * from uploads where id = $1', [id]);
      if (!row || row.kind !== 'material') continue;
      let text: string | null = row.text;
      if (text === null) {
        const ctx = usageContext.getStore();
        text = await usageContext.run({ lessonId: ctx?.lessonId ?? null, step: 'materials' }, () => this.read(row));
        text = text.slice(0, MAX_TEXT);
        await this.db.query('update uploads set text = $2 where id = $1', [id, text]);
        this.logger.log(`Đã đọc tư liệu "${row.name}": ${text.length} ký tự`);
      }
      out.push({ name: row.name, text });
    }
    return out;
  }

  private async read(row: any): Promise<string> {
    const data = await this.storage.read(row.file_key);
    const label = `Đọc tư liệu ${row.name}`;
    const ask = 'Chép lại toàn bộ nội dung tư liệu này.';
    if (row.mime === DOCX_MIME) {
      const doc = readDocx(data);
      const images = doc.images.slice(0, MAX_DOCX_IMAGES);
      if (!images.length) return doc.text;
      // Chữ đã có sẵn trong XML; chỉ nhờ AI đọc phần nằm trong ảnh nhúng
      const parts: Part[] = [
        ...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.data.toString('base64') } })),
        { text: 'Đây là các ảnh nhúng trong một file Word. Chép lại chữ và mô tả nội dung từng ảnh, đánh số [Ảnh 1], [Ảnh 2]...' },
      ];
      const fromImages = await this.gemini.text(label, parts, { system: OCR_SYSTEM });
      return `${doc.text}\n\n--- Nội dung trong ảnh của tài liệu ---\n${fromImages}`;
    }
    return this.gemini.text(label, [{ inlineData: { mimeType: row.mime, data: data.toString('base64') } }, { text: ask }], {
      system: OCR_SYSTEM,
    });
  }
}
