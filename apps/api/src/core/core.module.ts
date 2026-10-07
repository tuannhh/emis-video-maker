import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AssetsRepo } from './assets.repo.js';
import { config } from './config.js';
import { DbService } from './db.service.js';
import { GeminiService } from './gemini.service.js';
import { JobsService } from './jobs.service.js';
import { LessonsRepo } from './lessons.repo.js';
import { LESSON_QUEUE } from './queue.js';
import { SettingsService } from './settings.service.js';
import { SoundService } from './sound.service.js';
import { StorageService } from './storage.service.js';
import { UsageService } from './usage.service.js';

const queue = BullModule.registerQueue({ name: LESSON_QUEUE });
/** Trên Cloud Run không dùng Redis: mỗi việc chạy một Cloud Run Job */
const bull = config.queue.driver === 'bullmq';

const services = [
  DbService,
  StorageService,
  UsageService,
  SettingsService,
  GeminiService,
  LessonsRepo,
  AssetsRepo,
  SoundService,
  JobsService,
];

@Global()
@Module({
  imports: bull
    ? [
        // BullMQ 6 chạy ESM không tự nạp được ioredis: truyền sẵn client (worker sẽ tự nhân bản kết nối chặn)
        BullModule.forRootAsync({
          useFactory: () => ({ connection: new Redis({ ...config.redis, maxRetriesPerRequest: null }) }),
        }),
        queue,
      ]
    : [],
  providers: services,
  exports: bull ? [...services, queue] : services,
})
export class CoreModule {}
