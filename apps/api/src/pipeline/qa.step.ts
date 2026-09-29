import { Inject, Injectable } from '@nestjs/common';
import { QaReportSchema, type LessonScript, type QaReport } from '@edu/shared';
import { GeminiService } from '../core/gemini.service.js';
import { qaPrompt } from './prompts.js';

@Injectable()
export class QaStep {
  constructor(@Inject(GeminiService) private readonly gemini: GeminiService) {}

  async run(script: LessonScript, videoPath: string): Promise<QaReport> {
    const file = await this.gemini.uploadVideo(videoPath);
    try {
      return await this.gemini.json(
        'AI kiểm tra video',
        QaReportSchema,
        [{ fileData: { fileUri: file.uri!, mimeType: 'video/mp4' } }, { text: qaPrompt(script) }],
        { temperature: 0.2 },
      );
    } finally {
      await this.gemini.deleteFile(file.name!);
    }
  }
}
