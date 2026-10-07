import { getQueueToken } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Queue } from 'bullmq';
import { config } from './config.js';
import { googleApi } from './gcp.js';
import { LESSON_QUEUE, type LessonJobName, type ProduceJobData, type ScriptJobData } from './queue.js';

const JOB_OPTS = { attempts: 1, removeOnComplete: 200, removeOnFail: 200 };

/**
 * Giao việc nặng (viết kịch bản, sản xuất video) cho worker.
 * - bullmq: đẩy vào hàng đợi Redis, tiến trình worker lấy ra chạy.
 * - cloudrun: chạy một lần Cloud Run Job, truyền việc qua biến môi trường JOB_NAME / JOB_DATA (xem job.ts).
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(@Inject(ModuleRef) private readonly moduleRef: ModuleRef) {}

  async enqueue(name: LessonJobName, data: ScriptJobData | ProduceJobData) {
    if (config.queue.driver === 'cloudrun') return this.runCloudJob(name, data);
    const queue = this.moduleRef.get<Queue>(getQueueToken(LESSON_QUEUE), { strict: false });
    await queue.add(name, data, JOB_OPTS);
  }

  private async runCloudJob(name: LessonJobName, data: ScriptJobData | ProduceJobData) {
    const { project, region, job } = config.queue;
    const op = await googleApi<{ name: string }>(
      `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`,
      {
        method: 'POST',
        body: {
          overrides: {
            containerOverrides: [
              {
                env: [
                  { name: 'JOB_NAME', value: name },
                  { name: 'JOB_DATA', value: JSON.stringify(data) },
                ],
              },
            ],
          },
        },
      },
    );
    this.logger.log(`Đã chạy Cloud Run Job ${job} cho ${name} ${data.lessonId} (${op.name.split('/').pop()})`);
  }
}
