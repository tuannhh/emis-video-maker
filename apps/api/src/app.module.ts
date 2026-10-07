import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CoreModule } from './core/core.module.js';
import { AssetsController } from './http/assets.controller.js';
import { AuthController, SettingsController, UsersController } from './http/auth.controller.js';
import { AuthGuard } from './http/auth.guard.js';
import { AuthService } from './http/auth.service.js';
import { FilesController } from './http/files.controller.js';
import { LessonsController } from './http/lessons.controller.js';
import { LessonsService } from './http/lessons.service.js';
import { SoundsController } from './http/sounds.controller.js';
import { UsageController } from './http/usage.controller.js';

@Module({
  imports: [CoreModule],
  controllers: [
    AuthController,
    UsersController,
    SettingsController,
    LessonsController,
    AssetsController,
    FilesController,
    SoundsController,
    UsageController,
  ],
  providers: [AuthService, LessonsService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
