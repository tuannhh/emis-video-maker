import { Inject, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { STEP_LABELS, STORYBOARD_VERSION, type LessonIdea, type ProductionStep } from '@edu/shared';
import { LessonsRepo } from '../core/lessons.repo.js';
import { SoundService } from '../core/sound.service.js';
import { StorageService } from '../core/storage.service.js';
import { UploadsService } from '../core/uploads.service.js';
import { usageContext, type UsageContext } from '../core/usage.service.js';
import { AssetsStep, type StyleRef } from './assets.step.js';
import { QaStep } from './qa.step.js';
import { RenderStep } from './render.step.js';
import { ScriptStep, styleTag } from './script.step.js';
import { StoryboardStep } from './storyboard.step.js';
import { buildRenderProps } from './timeline.js';
import { VoiceStep } from './voice.step.js';

/** Trọng số tiến độ của từng bước trong tổng thời gian sản xuất */
const WEIGHTS: Record<ProductionStep, [number, number]> = {
  storyboard: [0, 5],
  assets: [5, 40],
  voice: [40, 55],
  render: [55, 92],
  qa: [92, 100],
};

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    @Inject(LessonsRepo) private readonly lessons: LessonsRepo,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(SoundService) private readonly sound: SoundService,
    @Inject(UploadsService) private readonly uploads: UploadsService,
    @Inject(ScriptStep) private readonly scriptStep: ScriptStep,
    @Inject(StoryboardStep) private readonly storyboardStep: StoryboardStep,
    @Inject(AssetsStep) private readonly assetsStep: AssetsStep,
    @Inject(VoiceStep) private readonly voiceStep: VoiceStep,
    @Inject(RenderStep) private readonly renderStep: RenderStep,
    @Inject(QaStep) private readonly qaStep: QaStep,
  ) {}

  /** Mọi lượt gọi Gemini bên trong được ghi token cho bài học này */
  private withUsage<T>(lessonId: string, step: string, fn: (ctx: UsageContext) => Promise<T>) {
    const ctx: UsageContext = { lessonId, step };
    return usageContext.run(ctx, () => fn(ctx));
  }

  generateScript(lessonId: string, feedback?: string) {
    return this.withUsage(lessonId, 'script', () => this.doGenerateScript(lessonId, feedback));
  }

  /**
   * Sản xuất video. `audioOnly`: chỉ đổi nhạc nền/hiệu ứng — dùng lại storyboard, tài sản, giọng đọc (đều đã cache)
   * và kết quả AI kiểm tra, chỉ render lại.
   */
  produce(lessonId: string, restage = false, audioOnly = false) {
    return this.withUsage(lessonId, 'storyboard', (ctx) => this.doProduce(lessonId, restage, audioOnly, ctx));
  }

  private async doGenerateScript(lessonId: string, feedback?: string) {
    const lesson = await this.mustGet(lessonId);
    await this.lessons.update(lessonId, { status: 'generating_script', step: 'script', progress: 10, error: null });
    await this.lessons.addEvent(lessonId, 'step', feedback ? 'AI đang viết lại kịch bản theo góp ý' : 'AI đang viết kịch bản');
    try {
      const materials = lesson.idea.materialIds?.length ?? 0;
      if (materials) {
        await this.lessons.addEvent(lessonId, 'step', `AI đang đọc ${materials} tư liệu tham khảo`);
        const read = await this.scriptStep.readMaterials(lesson.idea);
        const chars = read.reduce((a, m) => a + m.text.length, 0);
        await this.lessons.update(lessonId, { progress: 40 });
        await this.lessons.addEvent(lessonId, 'step', `Đã đọc ${read.length} tư liệu (${chars.toLocaleString('vi-VN')} ký tự), đang viết kịch bản`);
      }
      const script = await this.scriptStep.run(lesson.idea, feedback, lesson.script);
      await this.lessons.update(lessonId, {
        script,
        title: script.title,
        status: 'script_review',
        step: null,
        progress: 100,
      });
      await this.lessons.addEvent(lessonId, 'ready', 'Kịch bản đã sẵn sàng, chờ duyệt');
    } catch (err) {
      await this.fail(lessonId, 'script', err);
    }
  }

  private async doProduce(lessonId: string, restage: boolean, audioOnly: boolean, ctx: UsageContext) {
    const lesson = await this.mustGet(lessonId);
    const script = lesson.script;
    if (!script) throw new Error('Bài học chưa có kịch bản');

    let current: ProductionStep = 'storyboard';
    const enter = async (step: ProductionStep) => {
      current = step;
      ctx.step = step;
      await this.lessons.update(lessonId, { step, progress: WEIGHTS[step][0] });
      await this.lessons.addEvent(lessonId, 'step', STEP_LABELS[step]);
    };
    const progressFor = (step: ProductionStep) => async (pct: number) => {
      const [a, b] = WEIGHTS[step];
      await this.lessons.update(lessonId, { progress: Math.round(a + ((b - a) * pct) / 100) });
    };

    await this.lessons.update(lessonId, { status: 'producing', error: null });
    try {
      await enter('storyboard');
      // Storyboard kiểu cũ (trước khi có ngôn ngữ hình ảnh mới) được dàn dựng lại
      let board = restage || lesson.storyboard?.v !== STORYBOARD_VERSION ? null : lesson.storyboard;
      if (!board) {
        board = await this.storyboardStep.run(script, restage ? lesson.feedback : null, lesson.idea);
        await this.lessons.update(lessonId, { storyboard: board });
      }

      await enter('assets');
      const assets = await this.assetsStep.run(script, board, progressFor('assets'), await this.styleRef(lesson.idea));
      for (const w of assets.warnings) await this.lessons.addEvent(lessonId, 'warn', w);

      await enter('voice');
      const voices = await this.voiceStep.run(script, progressFor('voice'));

      await enter('render');
      ctx.step = 'music';
      const music = await this.sound.resolveMusic(lesson.audio.musicId, lesson.idea.subject);
      ctx.step = 'render';
      const { props, cues } = buildRenderProps({
        script,
        board,
        assets,
        voices,
        url: (key) => this.storage.internalUrl(key),
        burnSubtitles: lesson.idea.burnSubtitles ?? true,
        audio: lesson.audio,
        sfxKeys: await this.sound.sfxKeys(),
        music,
      });
      const rendered = await this.renderStep.run(lessonId, props, cues, progressFor('render'));
      await this.lessons.update(lessonId, { output: rendered.output });

      if (audioOnly && lesson.qa) {
        // Chỉ đổi âm thanh nền: hình và lời không đổi, giữ kết quả kiểm tra cũ
        await rendered.cleanup();
        await this.lessons.update(lessonId, { status: 'final_review', step: null, progress: 100 });
        await this.lessons.addEvent(lessonId, 'ready', 'Đã render lại với nhạc nền/hiệu ứng mới');
        return;
      }

      await enter('qa');
      try {
        const qa = await this.qaStep.run(script, rendered.videoPath);
        await this.lessons.update(lessonId, { qa });
        await this.lessons.addEvent(lessonId, 'qa', `AI kiểm tra: ${qa.verdict} — ${qa.summary}`);
      } catch (err) {
        // Kiểm tra tự động lỗi không chặn việc duyệt thành phẩm
        this.logger.warn(`QA lỗi: ${(err as Error).message}`);
        await this.lessons.update(lessonId, { qa: null });
        await this.lessons.addEvent(lessonId, 'warn', 'AI không kiểm tra được video, cần người duyệt xem kỹ');
      } finally {
        await rendered.cleanup();
      }

      await this.lessons.update(lessonId, { status: 'final_review', step: null, progress: 100 });
      await this.lessons.addEvent(lessonId, 'ready', 'Video đã sẵn sàng, chờ duyệt thành phẩm');
    } catch (err) {
      await this.fail(lessonId, current, err);
    }
  }

  /** Ảnh phong cách của bài (thu nhỏ, đổi sang PNG để gửi kèm khi vẽ) */
  private async styleRef(idea: LessonIdea): Promise<StyleRef | null> {
    const tag = styleTag(idea);
    if (!idea.styleRefId || !tag) return null;
    const { data } = await this.uploads.image(idea.styleRefId, ['style']);
    const image = await sharp(data).resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return { image, mime: 'image/png', tag };
  }

  private async mustGet(id: string) {
    const lesson = await this.lessons.get(id);
    if (!lesson) throw new Error(`Không tìm thấy bài học ${id}`);
    return lesson;
  }

  private async fail(lessonId: string, step: ProductionStep | 'script', err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`Bài ${lessonId} lỗi ở bước ${step}: ${message}`, err instanceof Error ? err.stack : undefined);
    await this.lessons.update(lessonId, { status: 'failed', step, error: message });
    await this.lessons.addEvent(lessonId, 'error', `Lỗi ở bước "${STEP_LABELS[step]}": ${message}`);
  }
}
