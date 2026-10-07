import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import type { Server } from 'node:http';
import { config } from './core/config.js';
import type { LessonJobName, ProduceJobData, ScriptJobData } from './core/queue.js';
import { PipelineModule } from './pipeline/pipeline.module.js';
import { PipelineService } from './pipeline/pipeline.service.js';

/**
 * Chạy đúng một việc rồi thoát: dùng làm Cloud Run Job (API gọi jobs:run, truyền JOB_NAME và JOB_DATA).
 * Bài học bị lỗi được pipeline tự ghi trạng thái "failed", người dùng bấm "Chạy lại" trên giao diện.
 */
async function main() {
  const name = process.env.JOB_NAME as LessonJobName | undefined;
  const data = JSON.parse(process.env.JOB_DATA ?? '{}') as ScriptJobData & ProduceJobData;
  if (!name || !data.lessonId) throw new Error('Thiếu JOB_NAME hoặc JOB_DATA');

  // Renderer (Chromium) tải ảnh, âm thanh qua HTTP: phục vụ thẳng STORAGE_DIR trong tiến trình này
  const port = Number(new URL(config.filesInternalUrl).port || 80);
  const server = await new Promise<Server>((resolve) => {
    const s = express()
      .use('/files', express.static(config.storageDir, { fallthrough: false, dotfiles: 'allow' }))
      .listen(port, '127.0.0.1', () => resolve(s));
  });

  const app = await NestFactory.createApplicationContext(PipelineModule);
  try {
    const pipeline = app.get(PipelineService);
    Logger.log(`Bắt đầu ${name} cho bài ${data.lessonId}`, 'Job');
    if (name === 'script') await pipeline.generateScript(data.lessonId, data.feedback);
    else await pipeline.produce(data.lessonId, data.restage, data.audioOnly);
    Logger.log('Xong', 'Job');
  } finally {
    await app.close();
    server.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    Logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err), 'Job');
    process.exit(1);
  },
);
