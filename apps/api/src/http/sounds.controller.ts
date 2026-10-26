import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { SFX_IDS, VOICE_IDS, VOICE_YOUTH_IDS, normalizeForTts, type SfxId } from '@edu/shared';
import { AssetsRepo } from '../core/assets.repo.js';
import { GeminiService } from '../core/gemini.service.js';
import { youngerVoice } from '../pipeline/audio.js';
import { sha1 } from '../pipeline/util.js';
import { speechStyle, youthFactor } from '../pipeline/voice.step.js';
import { SoundService, audioExt } from '../core/sound.service.js';
import { StorageService } from '../core/storage.service.js';
import { usageContext } from '../core/usage.service.js';
import { AdminOnly } from './auth.guard.js';
import { ZodPipe } from './zod.pipe.js';

const GenerateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  style: z.string().trim().max(300).optional(),
  subject: z.string().trim().max(100).default(''),
  /** Bài học đang cần nhạc: token sáng tác được tính vào bài này */
  lessonId: z.string().uuid().optional(),
});

/** Nghe thử giọng nhân vật trước khi sản xuất */
const VoicePreviewSchema = z.object({
  voice: z.enum(VOICE_IDS),
  role: z.enum(['child', 'adult', 'mascot', 'narrator']),
  youth: z.enum(VOICE_YOUTH_IDS).optional(),
  name: z.string().trim().max(40).default(''),
  text: z.string().trim().max(200).optional(),
});

function previewText(role: string, name: string) {
  const me = name ? `Mình là ${name}. ` : '';
  if (role === 'child') return `Ồ! Xin chào các bạn! ${me}Hôm nay chúng mình cùng khám phá điều thú vị nhé!`;
  if (role === 'mascot') return `Xin chào các bạn nhỏ! ${me}Cùng mình học thật vui nào!`;
  if (role === 'adult') return `Chào các con! ${me}Hôm nay cô trò mình cùng tìm hiểu một bài học mới nhé.`;
  return `Ngày xửa ngày xưa, có một bạn nhỏ rất thích khám phá thế giới xung quanh.`;
}

function uploaded(req: Request): { data: Buffer; mime: string } {
  const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
  if (!audioExt(mime)) throw new BadRequestException('Chỉ nhận file âm thanh MP3, WAV, OGG, M4A, AAC hoặc WEBM');
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new BadRequestException('File rỗng');
  return { data: req.body, mime };
}

@Controller('api/sounds')
export class SoundsController {
  constructor(
    @Inject(SoundService) private readonly sound: SoundService,
    @Inject(AssetsRepo) private readonly repo: AssetsRepo,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(GeminiService) private readonly gemini: GeminiService,
  ) {}

  /** Đọc thử một câu bằng giọng, vai và độ trẻ đã chọn (đúng cách lồng tiếng khi sản xuất); cùng tham số thì dùng lại bản cũ */
  @Post('voice-preview')
  async voicePreview(@Body(new ZodPipe(VoicePreviewSchema)) body: z.infer<typeof VoicePreviewSchema>) {
    const text = normalizeForTts(body.text || previewText(body.role, body.name));
    const style = speechStyle({ role: body.role, voice: body.voice }, 'excited');
    const youth = youthFactor({ role: body.role, youth: body.youth });
    const key = `previews/voices/${sha1(body.voice, style, String(youth), text)}.wav`;
    if (!(await this.storage.exists(key))) {
      const wav = await this.gemini.speech('Nghe thử giọng', [{ text, style }], body.voice);
      await this.storage.put(key, youngerVoice(wav, youth));
    }
    return { url: this.storage.publicUrl(key) };
  }

  @Get('music')
  async music() {
    const list = await this.repo.list('music');
    return list.map((m) => ({ ...m, url: this.storage.publicUrl(m.files.audio) }));
  }

  /** Tải nhạc nền lên: gửi thẳng file trong thân request (Content-Type: audio/...) */
  @Post('music/upload')
  async uploadMusic(@Req() req: Request, @Query('name') name?: string) {
    const { data, mime } = uploaded(req);
    const asset = await this.sound.uploadMusic(data, mime, (name ?? '').slice(0, 80) || 'Nhạc tải lên');
    return { ...asset, url: this.storage.publicUrl(asset.files.audio) };
  }

  /** AI (Lyria) sáng tác nhạc nền, mất khoảng 20–40 giây */
  @Post('music/generate')
  async generateMusic(@Body(new ZodPipe(GenerateSchema)) body: z.infer<typeof GenerateSchema>) {
    const asset = await usageContext.run({ lessonId: body.lessonId ?? null, step: 'music' }, () =>
      this.sound.generateMusic(body.name, body.subject, body.style),
    );
    return { ...asset, url: this.storage.publicUrl(asset.files.audio) };
  }

  /** Nhạc mặc định và kho hiệu ứng là cấu hình chung: chỉ admin đổi */
  @AdminOnly()
  @Post('music/:id/default')
  @HttpCode(204)
  async setDefault(@Param('id', ParseUUIDPipe) id: string) {
    const a = await this.repo.getById(id);
    if (a?.kind !== 'music') throw new NotFoundException('Không tìm thấy bản nhạc');
    await this.sound.setDefaultMusic(id);
  }

  @AdminOnly()
  @Delete('music/:id')
  @HttpCode(204)
  async deleteMusic(@Param('id', ParseUUIDPipe) id: string) {
    const a = await this.repo.getById(id);
    if (a?.kind !== 'music') throw new NotFoundException('Không tìm thấy bản nhạc');
    await this.repo.delete(id);
  }

  @Get('sfx')
  async sfx() {
    return this.sound.listSfx();
  }

  /** Thay một hiệu ứng có sẵn bằng file của người dùng */
  @AdminOnly()
  @Post('sfx/:id/upload')
  async uploadSfx(@Param('id') id: string, @Req() req: Request, @Query('name') name?: string) {
    if (!SFX_IDS.includes(id as SfxId)) throw new NotFoundException('Không có hiệu ứng này');
    const { data, mime } = uploaded(req);
    await this.sound.uploadSfx(id as SfxId, data, mime, (name ?? '').slice(0, 80));
    return this.sound.listSfx();
  }

  /** Bỏ file thay thế, quay về hiệu ứng tổng hợp sẵn */
  @AdminOnly()
  @Delete('sfx/:id')
  async resetSfx(@Param('id') id: string) {
    const a = await this.repo.get('sfx', id);
    if (a) await this.repo.delete(a.id);
    return this.sound.listSfx();
  }
}
