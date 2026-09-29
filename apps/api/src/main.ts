import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, raw } from 'express';
import { AppModule } from './app.module.js';
import { config } from './core/config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Tải file âm thanh (nhạc nền, hiệu ứng) gửi thẳng thân request dạng audio/*
  app.use('/api/sounds', raw({ type: 'audio/*', limit: '40mb' }));
  app.use(json({ limit: '5mb' }));
  app.enableCors({ origin: config.webOrigin });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`API chạy tại http://localhost:${config.port}`, 'Bootstrap');
}

void bootstrap();
