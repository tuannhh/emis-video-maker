import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { AssetsController } from './http/assets.controller.js';
import { FilesController } from './http/files.controller.js';
import { LessonsController } from './http/lessons.controller.js';
import { LessonsService } from './http/lessons.service.js';
import { SoundsController } from './http/sounds.controller.js';
import { UsageController } from './http/usage.controller.js';

@Module({
  imports: [CoreModule],
  controllers: [LessonsController, AssetsController, FilesController, SoundsController, UsageController],
  providers: [LessonsService],
})
export class AppModule {}
