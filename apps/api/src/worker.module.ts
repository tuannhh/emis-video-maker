import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { AssetsStep } from './pipeline/assets.step.js';
import { LessonProcessor } from './pipeline/lesson.processor.js';
import { PipelineService } from './pipeline/pipeline.service.js';
import { QaStep } from './pipeline/qa.step.js';
import { RenderStep } from './pipeline/render.step.js';
import { ScriptStep } from './pipeline/script.step.js';
import { StoryboardStep } from './pipeline/storyboard.step.js';
import { VoiceStep } from './pipeline/voice.step.js';

@Module({
  imports: [CoreModule],
  providers: [
    ScriptStep,
    StoryboardStep,
    AssetsStep,
    VoiceStep,
    RenderStep,
    QaStep,
    PipelineService,
    LessonProcessor,
  ],
})
export class WorkerModule {}
