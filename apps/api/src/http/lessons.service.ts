import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { lessonPath, type AudioSettings, type Lesson, type LessonIdea, type LessonScript, type LessonStatus } from '@edu/shared';
import { LessonsRepo } from '../core/lessons.repo.js';
import { JobsService } from '../core/jobs.service.js';
import type { LessonJobName, ProduceJobData, ScriptJobData } from '../core/queue.js';
import { StorageService } from '../core/storage.service.js';
import { sanitizeScript } from '../pipeline/script.step.js';

@Injectable()
export class LessonsService {
  constructor(
    @Inject(LessonsRepo) private readonly repo: LessonsRepo,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  private enqueue(name: LessonJobName, data: ScriptJobData | ProduceJobData) {
    return this.jobs.enqueue(name, data);
  }

  async get(id: string) {
    const lesson = await this.repo.get(id);
    if (!lesson) throw new NotFoundException('Không tìm thấy bài học');
    return lesson;
  }

  private expect(lesson: Lesson, ...statuses: LessonStatus[]) {
    if (!statuses.includes(lesson.status)) {
      throw new ConflictException(`Không thể thực hiện khi bài học đang ở trạng thái "${lesson.status}"`);
    }
  }

  async create(idea: LessonIdea, userId: string) {
    const lesson = await this.repo.create(idea, userId);
    await this.repo.addEvent(lesson.id, 'created', 'Đã nhận ý tưởng');
    await this.enqueue('script', { lessonId: lesson.id });
    return lesson;
  }

  async saveScript(id: string, script: LessonScript) {
    const lesson = await this.get(id);
    this.expect(lesson, 'script_review');
    const ids = new Set(script.characters.map((c) => c.id));
    if (ids.size !== script.characters.length) throw new BadRequestException('Mã nhân vật bị trùng');
    await this.repo.update(id, { script: sanitizeScript(script), title: script.title });
    return this.get(id);
  }

  async regenerateScript(id: string, feedback: string) {
    const lesson = await this.get(id);
    this.expect(lesson, 'script_review', 'failed');
    await this.repo.update(id, { status: 'generating_script', step: 'script', progress: 0, feedback });
    await this.repo.addEvent(id, 'feedback', `Yêu cầu viết lại: ${feedback}`);
    await this.enqueue('script', { lessonId: id, feedback });
  }

  async approveScript(id: string) {
    const lesson = await this.get(id);
    this.expect(lesson, 'script_review');
    // Kịch bản có thể đã được sửa: dàn dựng lại từ đầu
    await this.repo.update(id, { status: 'producing', step: 'storyboard', progress: 0, storyboard: null, feedback: null });
    await this.repo.addEvent(id, 'approved', 'Kịch bản đã được duyệt, bắt đầu sản xuất video');
    await this.enqueue('produce', { lessonId: id });
  }

  async approveFinal(id: string) {
    const lesson = await this.get(id);
    this.expect(lesson, 'final_review');
    await this.repo.update(id, { status: 'approved' });
    await this.repo.addEvent(id, 'approved', 'Thành phẩm đã được duyệt');
  }

  async rejectFinal(id: string, feedback: string, mode: 'script' | 'video') {
    const lesson = await this.get(id);
    this.expect(lesson, 'final_review', 'approved');
    await this.repo.addEvent(id, 'feedback', `Từ chối thành phẩm (${mode === 'script' ? 'sửa kịch bản' : 'dựng lại video'}): ${feedback}`);
    if (mode === 'script') {
      await this.repo.update(id, { status: 'generating_script', step: 'script', progress: 0, feedback });
      await this.enqueue('script', { lessonId: id, feedback });
    } else {
      await this.repo.update(id, { status: 'producing', step: 'storyboard', progress: 0, feedback });
      await this.enqueue('produce', { lessonId: id, restage: true });
    }
  }

  /**
   * Đổi nhạc nền / hiệu ứng. Video đã render thì render lại (không gọi lại AI vẽ, lồng tiếng hay kiểm tra);
   * chưa render thì lưu lại để dùng khi sản xuất.
   */
  async updateAudio(id: string, audio: AudioSettings, rerender: boolean) {
    const lesson = await this.get(id);
    await this.repo.update(id, { audio });
    if (rerender && lesson.output && (lesson.status === 'final_review' || lesson.status === 'approved')) {
      await this.repo.update(id, { status: 'producing', step: 'render', progress: 55, error: null });
      await this.repo.addEvent(id, 'audio', 'Đổi nhạc nền / hiệu ứng, render lại video');
      await this.enqueue('produce', { lessonId: id, audioOnly: true });
    }
    return this.get(id);
  }

  async retry(id: string) {
    const lesson = await this.get(id);
    this.expect(lesson, 'failed');
    await this.repo.addEvent(id, 'retry', 'Chạy lại từ bước bị lỗi');
    if (lesson.step === 'script' || !lesson.script) {
      await this.repo.update(id, { status: 'generating_script', error: null });
      await this.enqueue('script', { lessonId: id, feedback: lesson.feedback ?? undefined });
    } else {
      await this.repo.update(id, { status: 'producing', error: null });
      await this.enqueue('produce', { lessonId: id });
    }
  }

  /** Chỉ người tạo bài hoặc admin được xoá */
  async delete(id: string, user: { id: string; role: string }) {
    const lesson = await this.get(id);
    if (user.role !== 'admin' && lesson.createdBy !== user.id) {
      throw new ForbiddenException('Chỉ người tạo bài hoặc admin mới được xoá bài học này');
    }
    if (lesson.status === 'producing' || lesson.status === 'generating_script') {
      throw new ConflictException('Bài học đang được xử lý, không thể xoá lúc này');
    }
    await this.repo.delete(id);
    await this.storage.removePrefix(`lessons/${id}`);
  }

  withUrls(lesson: Lesson) {
    const o = lesson.output;
    return {
      ...lesson,
      path: lessonPath(lesson),
      urls: o
        ? {
            video: this.storage.publicUrl(o.videoKey),
            thumbnail: this.storage.publicUrl(o.thumbnailKey),
            srt: this.storage.publicUrl(o.srtKey),
          }
        : null,
    };
  }
}
