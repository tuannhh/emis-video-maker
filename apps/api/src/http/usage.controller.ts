import { Controller, Get, Inject } from '@nestjs/common';
import { UsageService } from '../core/usage.service.js';

@Controller('api/usage')
export class UsageController {
  constructor(@Inject(UsageService) private readonly usage: UsageService) {}

  /** Tổng token Gemini toàn hệ thống (kể cả bài đã xoá) */
  @Get()
  async all() {
    return this.usage.summary(null);
  }
}
