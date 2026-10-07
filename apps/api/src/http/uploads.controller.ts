import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { UPLOAD_KINDS, VOICE_IDS, type UploadKind } from '@edu/shared';
import { UploadsService } from '../core/uploads.service.js';
import { CurrentUser } from './auth.guard.js';
import type { SessionUser } from './auth.service.js';
import { CharactersService } from './characters.service.js';
import { ZodPipe } from './zod.pipe.js';

@Controller('api/uploads')
export class UploadsController {
  constructor(@Inject(UploadsService) private readonly uploads: UploadsService) {}

  /** Tải tệp lên: gửi thẳng nội dung file trong thân request, ?kind=material|style|reference|mascot&name=ten-file */
  @Post()
  async upload(@CurrentUser() user: SessionUser, @Req() req: Request, @Query('kind') kind?: string, @Query('name') name?: string) {
    if (!UPLOAD_KINDS.includes(kind as UploadKind)) throw new BadRequestException('Loại tệp không hợp lệ');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new BadRequestException('Tệp rỗng');
    return this.uploads.create(kind as UploadKind, name ?? '', req.body, user.id);
  }

  /** Thông tin các tệp (để hiện tư liệu, ảnh phong cách của bài học) */
  @Get()
  async list(@Query('ids') ids?: string) {
    const list = (ids ?? '').split(',').filter((id) => z.string().uuid().safeParse(id).success).slice(0, 20);
    return this.uploads.list(list);
  }
}

const SuggestSchema = z.object({
  referenceId: z.string().uuid().optional(),
  draft: z.string().trim().max(1000).optional(),
  topic: z.string().trim().max(500).optional(),
  subject: z.string().trim().max(100).optional(),
  grade: z.string().trim().max(50).optional(),
});
const PreviewSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('mascot'), uploadId: z.string().uuid() }),
  z.object({
    mode: z.literal('design'),
    prompt: z.string().trim().max(1500),
    referenceId: z.string().uuid().optional(),
    styleId: z.string().uuid().optional(),
  }),
]);
const CreateSchema = z.object({
  previewId: z.string().uuid(),
  name: z.string().trim().min(1, 'Nhập tên nhân vật').max(60),
  voice: z.enum(VOICE_IDS),
  role: z.enum(['child', 'adult', 'mascot']),
  description: z.string().trim().min(10).max(1500).optional(),
});

/** Tạo nhân vật mới cho thư viện (mọi thành viên) */
@Controller('api/characters')
export class CharactersController {
  constructor(@Inject(CharactersService) private readonly characters: CharactersService) {}

  @Post('suggest')
  suggest(@Body(new ZodPipe(SuggestSchema)) body: z.infer<typeof SuggestSchema>) {
    return this.characters.suggest(body);
  }

  /** Vẽ bản xem trước (mất khoảng 15–40 giây) */
  @Post('preview')
  preview(@CurrentUser() user: SessionUser, @Body(new ZodPipe(PreviewSchema)) body: z.infer<typeof PreviewSchema>) {
    if (body.mode === 'design' && !body.prompt && !body.referenceId) {
      throw new BadRequestException('Nhập yêu cầu hoặc tải ảnh tham chiếu');
    }
    return this.characters.preview(body, user.id);
  }

  @Post()
  create(@Body(new ZodPipe(CreateSchema)) body: z.infer<typeof CreateSchema>) {
    return this.characters.create(body);
  }
}
