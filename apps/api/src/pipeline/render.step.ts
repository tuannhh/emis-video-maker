import { Inject, Injectable, Logger } from '@nestjs/common';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { LessonRenderProps, RenderOutput } from '@edu/shared';
import { config } from '../core/config.js';
import { StorageService } from '../core/storage.service.js';
import { toSrt, type SubtitleCue } from './timeline.js';
import type { Progress } from './util.js';

const require = createRequire(import.meta.url);

@Injectable()
export class RenderStep {
  private readonly logger = new Logger(RenderStep.name);
  private serveUrl: Promise<string> | null = null;

  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** Đóng gói project Remotion một lần cho mỗi tiến trình worker. */
  private getServeUrl() {
    if (!this.serveUrl) {
      const pkgDir = path.dirname(require.resolve('@edu/video/package.json'));
      const entryPoint = path.join(pkgDir, 'src', 'index.ts');
      this.logger.log('Đóng gói Remotion...');
      this.serveUrl = bundle({ entryPoint, outDir: path.join(os.tmpdir(), 'edu-video-bundle') }).catch((err) => {
        this.serveUrl = null;
        throw err;
      });
    }
    return this.serveUrl;
  }

  async run(lessonId: string, props: LessonRenderProps, cues: SubtitleCue[], progress: Progress) {
    const serveUrl = await this.getServeUrl();
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `edu-render-${lessonId.slice(0, 8)}-`));
    const videoPath = path.join(workDir, 'lesson.mp4');
    const stillPath = path.join(workDir, 'thumb.png');

    const composition = await selectComposition({ serveUrl, id: 'Lesson', inputProps: props });
    let last = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      crf: 20,
      audioCodec: 'aac',
      outputLocation: videoPath,
      inputProps: props,
      concurrency: config.render.concurrency,
      timeoutInMilliseconds: 120_000,
      onProgress: ({ progress: p }) => {
        const pct = Math.floor(p * 100);
        if (pct >= last + 5) {
          last = pct;
          void progress(pct, `Đang render ${pct}%`);
        }
      },
    });
    await renderStill({
      composition,
      serveUrl,
      output: stillPath,
      frame: Math.min(60, composition.durationInFrames - 1),
      inputProps: props,
    });

    const stamp = Date.now();
    const prefix = `lessons/${lessonId}/${stamp}`;
    const output: RenderOutput = {
      videoKey: await this.storage.putFromFile(`${prefix}/video.mp4`, videoPath),
      thumbnailKey: await this.storage.put(
        `${prefix}/thumbnail.jpg`,
        await sharp(stillPath).jpeg({ quality: 88 }).toBuffer(),
      ),
      srtKey: await this.storage.put(`${prefix}/subtitles.srt`, Buffer.from(toSrt(cues), 'utf8')),
      // Props đã tính thời gian: dán vào Remotion Studio để xem/chỉnh lại đúng video này
      propsKey: await this.storage.put(`${prefix}/props.json`, Buffer.from(JSON.stringify(props), 'utf8')),
      durationSec: Math.round((props.durationInFrames / props.fps) * 10) / 10,
      renderedAt: new Date(stamp).toISOString(),
    };
    return { output, videoPath, cleanup: () => fs.rm(workDir, { recursive: true, force: true }) };
  }
}
