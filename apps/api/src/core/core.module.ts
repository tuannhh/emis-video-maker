import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AssetsRepo } from './assets.repo.js';
import { config } from './config.js';
import { DbService } from './db.service.js';
import { GeminiService } from './gemini.service.js';
import { LessonsRepo } from './lessons.repo.js';
import { LESSON_QUEUE } from './queue.js';
import { SoundService } from './sound.service.js';
import { StorageService } from './storage.service.js';
import { UsageService } from './usage.service.js';

const queue = BullModule.registerQueue({ name: LESSON_QUEUE });

@Global()
@Module({
  imports: [
    // BullMQ 6 chạy ESM không tự nạp được ioredis: truyền sẵn client (worker sẽ tự nhân bản kết nối chặn)
    BullModule.forRootAsync({
      useFactory: () => ({ connection: new Redis({ ...config.redis, maxRetriesPerRequest: null }) }),
    }),
    queue,
  ],
  providers: [DbService, StorageService, UsageService, GeminiService, LessonsRepo, AssetsRepo, SoundService],
  exports: [DbService, StorageService, UsageService, GeminiService, LessonsRepo, AssetsRepo, SoundService, queue],
})
export class CoreModule {}
