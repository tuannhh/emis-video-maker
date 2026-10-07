import { Module } from '@nestjs/common';
import { LessonProcessor } from './pipeline/lesson.processor.js';
import { PipelineModule } from './pipeline/pipeline.module.js';

@Module({
  imports: [PipelineModule],
  providers: [LessonProcessor],
})
export class WorkerModule {}
