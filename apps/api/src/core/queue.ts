export const LESSON_QUEUE = 'lesson';

export interface ScriptJobData {
  lessonId: string;
  feedback?: string;
}

export interface ProduceJobData {
  lessonId: string;
  /** Dàn dựng lại storyboard (ví dụ khi người duyệt góp ý về hình ảnh) */
  restage?: boolean;
  /** Chỉ render lại vì đổi nhạc nền / hiệu ứng */
  audioOnly?: boolean;
}

export type LessonJobName = 'script' | 'produce';
