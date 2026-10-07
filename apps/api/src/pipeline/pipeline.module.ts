import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { AssetsStep } from './assets.step.js';
import { PipelineService } from './pipeline.service.js';
import { QaStep } from './qa.step.js';
import { RenderStep } from './render.step.js';
import { ScriptStep } from './script.step.js';
import { StoryboardStep } from './storyboard.step.js';
import { VoiceStep } from './voice.step.js';

/** Các bước sản xuất video, dùng chung cho worker (BullMQ) và Cloud Run Job */
@Module({
  imports: [CoreModule],
  providers: [ScriptStep, StoryboardStep, AssetsStep, VoiceStep, RenderStep, QaStep, PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
