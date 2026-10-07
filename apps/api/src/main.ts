import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, raw, type NextFunction, type Request, type Response } from 'express';
import { AppModule } from './app.module.js';
import { config } from './core/config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Tải file âm thanh (nhạc nền, hiệu ứng) gửi thẳng thân request dạng audio/*
  app.use('/api/sounds', raw({ type: 'audio/*', limit: '40mb' }));
  // Tư liệu, ảnh tham chiếu: loại tệp được nhận diện theo nội dung (UploadsService)
  app.use('/api/uploads', raw({ type: () => true, limit: '6mb' }));
  app.use('/api/uploads', (err: { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large') res.status(413).json({ statusCode: 413, message: 'Tệp quá lớn' });
    else next(err);
  });
  app.use(json({ limit: '5mb' }));
  app.enableCors({ origin: config.webOrigin });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`API chạy tại http://localhost:${config.port}`, 'Bootstrap');
}

void bootstrap();
