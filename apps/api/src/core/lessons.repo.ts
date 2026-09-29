import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AudioSettingsSchema, type Lesson, type LessonEvent, type LessonIdea } from '@edu/shared';
import { DbService } from './db.service.js';

const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Mã 6 ký tự ngẫu nhiên cho URL bài học */
function randomCode() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

const COLUMNS: Record<string, string> = {
  title: 'title',
  status: 'status',
  step: 'step',
  progress: 'progress',
  error: 'error',
  script: 'script',
  storyboard: 'storyboard',
  output: 'output',
  qa: 'qa',
  feedback: 'feedback',
  audio: 'audio',
};
const JSON_COLUMNS = new Set(['script', 'storyboard', 'output', 'qa', 'audio']);

function toLesson(r: any): Lesson {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    idea: r.idea,
    status: r.status,
    step: r.step,
    progress: r.progress,
    error: r.error,
    script: r.script,
    storyboard: r.storyboard,
    output: r.output,
    qa: r.qa,
    feedback: r.feedback,
    // Bài cũ chưa có cài đặt âm thanh: dùng mặc định (hoặc cài đặt lúc tạo)
    audio: AudioSettingsSchema.parse(r.audio ?? r.idea?.audio ?? {}),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

@Injectable()
export class LessonsRepo {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  async create(idea: LessonIdea): Promise<Lesson> {
    const audio = AudioSettingsSchema.parse(idea.audio ?? {});
    for (let attempt = 0; ; attempt++) {
      try {
        const row = await this.db.one(
          `insert into lessons (title, idea, status, step, code, audio)
           values ($1, $2, 'generating_script', 'script', $3, $4) returning *`,
          [idea.topic.slice(0, 200), JSON.stringify(idea), randomCode(), JSON.stringify(audio)],
        );
        return toLesson(row);
      } catch (err) {
        // Trùng mã (rất hiếm): sinh mã khác
        if ((err as { code?: string }).code !== '23505' || attempt >= 5) throw err;
      }
    }
  }

  async getByCode(code: string): Promise<Lesson | null> {
    const row = await this.db.one('select * from lessons where code = $1', [code]);
    return row ? toLesson(row) : null;
  }

  async get(id: string): Promise<Lesson | null> {
    const row = await this.db.one('select * from lessons where id = $1', [id]);
    return row ? toLesson(row) : null;
  }

  async list(): Promise<Lesson[]> {
    const rows = await this.db.query('select * from lessons order by created_at desc limit 200');
    return rows.map(toLesson);
  }

  async update(id: string, patch: Partial<Omit<Lesson, 'id' | 'idea' | 'createdAt' | 'updatedAt'>>) {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const col = COLUMNS[k];
      if (!col) continue;
      values.push(JSON_COLUMNS.has(k) && v !== null ? JSON.stringify(v) : v);
      sets.push(`${col} = $${values.length}`);
    }
    if (!sets.length) return;
    values.push(id);
    await this.db.query(
      `update lessons set ${sets.join(', ')}, updated_at = now() where id = $${values.length}`,
      values,
    );
  }

  async delete(id: string) {
    await this.db.query('delete from lessons where id = $1', [id]);
  }

  async addEvent(lessonId: string, type: string, message: string) {
    await this.db.query('insert into lesson_events (lesson_id, type, message) values ($1, $2, $3)', [
      lessonId,
      type,
      message,
    ]);
  }

  async events(lessonId: string): Promise<LessonEvent[]> {
    const rows = await this.db.query(
      'select * from lesson_events where lesson_id = $1 order by id desc limit 100',
      [lessonId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      lessonId: r.lesson_id,
      type: r.type,
      message: r.message,
      createdAt: r.created_at.toISOString(),
    }));
  }
}
