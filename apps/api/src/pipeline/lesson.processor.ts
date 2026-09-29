import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { LESSON_QUEUE, type ProduceJobData, type ScriptJobData } from '../core/queue.js';
import { PipelineService } from './pipeline.service.js';

@Processor(LESSON_QUEUE, { concurrency: 2, lockDuration: 10 * 60_000 })
export class LessonProcessor extends WorkerHost {
  private readonly logger = new Logger(LessonProcessor.name);

  constructor(@Inject(PipelineService) private readonly pipeline: PipelineService) {
    super();
  }

  async process(job: Job) {
    this.logger.log(`Bắt đầu job ${job.name} (${job.id})`);
    switch (job.name) {
      case 'script': {
        const data = job.data as ScriptJobData;
        return this.pipeline.generateScript(data.lessonId, data.feedback);
      }
      case 'produce': {
        const data = job.data as ProduceJobData;
        return this.pipeline.produce(data.lessonId, data.restage, data.audioOnly);
      }
      default:
        this.logger.warn(`Job không xác định: ${job.name}`);
    }
  }
}
