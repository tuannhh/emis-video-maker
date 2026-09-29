import {
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
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AudioSettingsSchema,
  LESSON_CODE,
  LessonIdeaSchema,
  LessonScriptSchema,
  type LessonIdea,
  type LessonScript,
} from '@edu/shared';
import { LessonsRepo } from '../core/lessons.repo.js';
import { UsageService } from '../core/usage.service.js';
import { LessonsService } from './lessons.service.js';
import { ZodPipe } from './zod.pipe.js';

const FeedbackSchema = z.object({ feedback: z.string().trim().min(3).max(2000) });
const RejectSchema = FeedbackSchema.extend({ mode: z.enum(['script', 'video']) });
const AudioBodySchema = z.object({ audio: AudioSettingsSchema, rerender: z.boolean().default(true) });

@Controller('api/lessons')
export class LessonsController {
  constructor(
    @Inject(LessonsService) private readonly service: LessonsService,
    @Inject(LessonsRepo) private readonly repo: LessonsRepo,
    @Inject(UsageService) private readonly usage: UsageService,
  ) {}

  @Get()
  async list() {
    const [lessons, tokens] = await Promise.all([this.repo.list(), this.usage.totalsByLesson()]);
    return lessons.map((l) => ({ ...this.service.withUrls(l), tokens: tokens[l.id] ?? 0 }));
  }

  /** Tìm bài theo mã 6 ký tự ở cuối URL /{môn}/{lớp}/{tên-bài}/{mã} */
  @Get('by-code/:code')
  async byCode(@Param('code') code: string) {
    if (!LESSON_CODE.test(code)) throw new NotFoundException('Không tìm thấy bài học');
    const lesson = await this.repo.getByCode(code);
    if (!lesson) throw new NotFoundException('Không tìm thấy bài học');
    return { lesson: this.service.withUrls(lesson), events: await this.repo.events(lesson.id) };
  }

  @Post()
  async create(@Body(new ZodPipe(LessonIdeaSchema)) idea: LessonIdea) {
    return this.service.create(idea);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const lesson = await this.service.get(id);
    return { lesson: this.service.withUrls(lesson), events: await this.repo.events(id) };
  }

  /** Tổng token Gemini của bài (mọi lần tạo và làm lại) */
  @Get(':id/usage')
  async usageOf(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.get(id);
    return this.usage.summary(id);
  }

  @Put(':id/audio')
  async updateAudio(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(AudioBodySchema)) body: z.infer<typeof AudioBodySchema>,
  ) {
    return this.service.withUrls(await this.service.updateAudio(id, body.audio, body.rerender));
  }

  @Put(':id/script')
  async saveScript(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(LessonScriptSchema)) script: LessonScript) {
    return this.service.saveScript(id, script);
  }

  @Post(':id/script/regenerate')
  @HttpCode(202)
  async regenerate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(FeedbackSchema)) body: { feedback: string }) {
    await this.service.regenerateScript(id, body.feedback);
  }

  @Post(':id/script/approve')
  @HttpCode(202)
  async approveScript(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.approveScript(id);
  }

  @Post(':id/final/approve')
  @HttpCode(204)
  async approveFinal(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.approveFinal(id);
  }

  @Post(':id/final/reject')
  @HttpCode(202)
  async rejectFinal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RejectSchema)) body: z.infer<typeof RejectSchema>,
  ) {
    await this.service.rejectFinal(id, body.feedback, body.mode);
  }

  @Post(':id/retry')
  @HttpCode(202)
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.retry(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.delete(id);
  }
}
