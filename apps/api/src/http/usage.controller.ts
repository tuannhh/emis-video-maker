import { Controller, Get, Inject } from '@nestjs/common';
import { UsageService } from '../core/usage.service.js';
import { AdminOnly } from './auth.guard.js';

/** Báo cáo chi phí: chỉ admin */
@AdminOnly()
@Controller('api/usage')
export class UsageController {
  constructor(@Inject(UsageService) private readonly usage: UsageService) {}

  /** Tổng token Gemini toàn hệ thống (kể cả bài đã xoá) */
  @Get()
  async all() {
    return this.usage.summary(null);
  }

  /** Chi phí theo từng bài học */
  @Get('lessons')
  async lessons() {
    return this.usage.byLesson();
  }
}
