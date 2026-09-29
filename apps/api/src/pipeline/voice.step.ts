import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { EMOTIONS, normalizeForTts, type Emotion, type LessonScript } from '@edu/shared';
import { config } from '../core/config.js';
import { DbService } from '../core/db.service.js';
import { GeminiService } from '../core/gemini.service.js';
import { StorageService } from '../core/storage.service.js';
import { analyzeSpeech, chooseCuts, findGaps, parseWav, sliceByCuts } from './audio.js';
import { ACCENT_PROMPT, TRANSCRIBE_PROMPT } from './prompts.js';
import { mapLimit, sha1, type Progress } from './util.js';

export const FPS = 30;
/** Tăng khi đổi cách tạo giọng để không dùng lại audio cũ trong cache */
const TTS_VERSION = 'v5-batch';
/**
 * Đã đo với gemini-3.8-flash-tts: không chỉ định thì mỗi request ra giọng Bắc hoặc Nam ngẫu nhiên
 * (đọc từng câu riêng: 2/6 câu giọng Nam). Chỉ định qua speechMetadata.style: 12/12 giọng Bắc, không bị đọc thành lời.
 */
const ACCENT = 'Standard Northern Vietnamese accent (Hà Nội)';
/** Số câu tối đa đọc chung một request; nhiều quá thì khó cắt chính xác */
const BATCH_LINES = 6;
const BATCH_CHARS = 520;

const AccentSchema = z.object({ accent: z.enum(['north', 'south', 'central', 'unclear']) });

export interface VoiceClip {
  fileKey: string;
  durationMs: number;
  mouth: string;
  level: string;
}

export interface ProducedVoices {
  intro: VoiceClip | null;
  introHost: string | null;
  /** key: `${sectionIndex}:${lineIndex}` */
  lines: Record<string, VoiceClip>;
}

interface Job {
  key: string;
  voice: string;
  text: string;
  style: string;
  hash: string;
}

@Injectable()
export class VoiceStep {
  private readonly logger = new Logger(VoiceStep.name);

  constructor(
    @Inject(GeminiService) private readonly gemini: GeminiService,
    @Inject(DbService) private readonly db: DbService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async run(script: LessonScript, progress: Progress): Promise<ProducedVoices> {
    const voiceOf = new Map(script.characters.map((c) => [c.id, c.voice]));
    const host = script.characters.find((c) => c.role !== 'narrator') ?? null;

    const jobs: Job[] = [];
    const add = (key: string, voice: string, text: string, emotion: Emotion) => {
      const style = `${ACCENT}; ${EMOTIONS[emotion]?.style ?? 'cheerful and friendly'}`;
      jobs.push({ key, voice, text, style, hash: sha1(config.gemini.ttsModel, TTS_VERSION, voice, style, text) });
    };
    if (host) {
      add('intro', host.voice, normalizeForTts(`Xin chào các bạn! Hôm nay chúng mình cùng học bài: ${script.title}.`), 'excited');
    }
    script.sections.forEach((s, si) =>
      s.lines.forEach((l, li) => add(`${si}:${li}`, voiceOf.get(l.speaker) ?? 'Kore', l.ttsText, l.emotion)),
    );

    const clips = new Map<string, VoiceClip>();
    for (const job of jobs) {
      const cached = await this.cached(job.hash);
      if (cached) clips.set(job.key, cached);
    }

    // Câu chưa có: gom theo giọng (mỗi nhân vật đọc liền các câu của mình trong một request) rồi cắt ra.
    // Câu có nhiều chỗ ngắt (đếm "một, hai, ba...") đọc riêng: khoảng nghỉ trong câu dài như giữa hai câu, khó cắt đúng.
    const pending = jobs.filter((j) => !clips.has(j.key));
    const batches: Job[][] = [];
    for (const j of pending.filter(isChoppy)) batches.push([j]);
    for (const voice of new Set(pending.map((j) => j.voice))) {
      let cur: Job[] = [];
      for (const j of pending.filter((p) => p.voice === voice && !isChoppy(p))) {
        const chars = cur.reduce((a, c) => a + c.text.length, 0);
        if (cur.length && (cur.length >= BATCH_LINES || chars + j.text.length > BATCH_CHARS)) {
          batches.push(cur);
          cur = [];
        }
        cur.push(j);
      }
      if (cur.length) batches.push(cur);
    }

    let done = jobs.length - pending.length;
    const report = () => progress(Math.round((done / Math.max(1, jobs.length)) * 100), `Đã lồng tiếng ${done}/${jobs.length} câu`);
    await report();

    await mapLimit(batches, 2, async (batch) => {
      const results = await this.synthesizeBatch(batch);
      for (const [job, wav] of results) {
        clips.set(job.key, await this.save(job, wav));
        done++;
      }
      await report();
    });

    const lines: Record<string, VoiceClip> = {};
    for (const [key, clip] of clips) if (key !== 'intro') lines[key] = clip;
    return { intro: clips.get('intro') ?? null, introHost: host?.id ?? null, lines };
  }

  private async cached(hash: string): Promise<VoiceClip | null> {
    const row = await this.db.one('select * from tts_cache where hash = $1', [hash]);
    if (!row || !(await this.storage.exists(row.file_key))) return null;
    if (!row.level) {
      // Bản cache cũ chưa có độ lớn giọng: tính lại từ file
      const { level } = analyzeSpeech(await this.storage.read(row.file_key), FPS);
      await this.db.query('update tts_cache set level = $2 where hash = $1', [hash, level]);
      row.level = level;
    }
    return { fileKey: row.file_key, durationMs: row.duration_ms, mouth: row.mouth, level: row.level };
  }

  private async save(job: Job, wav: Buffer): Promise<VoiceClip> {
    const { durationMs, mouth, level } = analyzeSpeech(wav, FPS);
    const fileKey = await this.storage.put(`audio/${job.hash}.wav`, wav);
    await this.db.query(
      `insert into tts_cache (hash, file_key, duration_ms, mouth, level) values ($1, $2, $3, $4, $5)
       on conflict (hash) do update set file_key = excluded.file_key, duration_ms = excluded.duration_ms,
         mouth = excluded.mouth, level = excluded.level`,
      [job.hash, fileKey, durationMs, mouth, level],
    );
    return { fileKey, durationMs, mouth, level };
  }

  /**
   * Đọc cả nhóm câu trong một request, cắt theo khoảng lặng, kiểm tra từng câu bằng cách chép lời
   * và kiểm tra vùng miền của cả đoạn. Câu nào cắt/đọc sai thì đọc lại riêng câu đó.
   */
  private async synthesizeBatch(batch: Job[]): Promise<[Job, Buffer][]> {
    const voice = batch[0].voice;
    const good = new Map<Job, Buffer>();

    for (let attempt = 1; attempt <= 2 && good.size < batch.length; attempt++) {
      const todo = batch.filter((j) => !good.has(j));
      if (todo.length < 2) break; // một câu thì đọc riêng bên dưới
      let wav: Buffer;
      try {
        wav = await this.gemini.speech('Lồng tiếng', todo.map((j) => ({ text: j.text, style: j.style })), voice);
      } catch (err) {
        this.logger.warn(`Đọc nhóm ${todo.length} câu lỗi: ${(err as Error).message}`);
        break;
      }
      const info = parseWav(wav);
      const gaps = findGaps(info);
      const cuts = chooseCuts(gaps, todo.map((j) => speechWeight(j.text)));
      if (!cuts) {
        this.logger.warn(`Không cắt được nhóm ${todo.length} câu (thiếu khoảng lặng), thử lại`);
        continue;
      }
      const segments = sliceByCuts(info, gaps, cuts);
      const [accent, checks] = await Promise.all([
        this.accent(wav),
        mapLimit(todo, 4, (j, i) => this.speaksExactly(segments[i], j.text)),
      ]);
      if (accent === 'south' || accent === 'central') {
        this.logger.warn(`Nhóm ${todo.length} câu giọng ${voice} ra giọng ${accent}, đọc lại`);
        continue;
      }
      todo.forEach((j, i) => {
        if (checks[i] && !tooSlow(segments[i], j.text)) good.set(j, segments[i]);
      });
      if (good.size < batch.length) {
        this.logger.warn(`Nhóm giọng ${voice}: ${batch.length - good.size}/${batch.length} câu chưa đạt sau lần ${attempt}`);
      }
    }

    // Câu còn lại: đọc riêng từng câu (vẫn chỉ định giọng Bắc), tối đa 3 lần
    await mapLimit(
      batch.filter((j) => !good.has(j)),
      3,
      async (job) => {
        let last: Buffer | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const wav = await this.gemini.speech('Lồng tiếng', [{ text: job.text, style: job.style }], voice);
          last = trimSilence(wav);
          const [ok, accent] = await Promise.all([this.speaksExactly(last, job.text), this.accent(last)]);
          if (ok && accent !== 'south' && accent !== 'central' && !tooSlow(last, job.text)) break;
        }
        good.set(job, last!);
      },
    );
    return batch.map((j) => [j, good.get(j)!]);
  }

  private async accent(wav: Buffer): Promise<z.infer<typeof AccentSchema>['accent']> {
    try {
      const r = await this.gemini.json(
        'Kiểm tra vùng miền giọng đọc',
        AccentSchema,
        [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }, { text: ACCENT_PROMPT }],
        { temperature: 0 },
      );
      return r.accent;
    } catch {
      return 'unclear';
    }
  }

  /** Chép lời và so với câu mong đợi: đủ giống và không có chữ thừa ở đầu (dấu hiệu đọc luôn chỉ dẫn / cắt lệch). */
  private async speaksExactly(wav: Buffer, expected: string): Promise<boolean> {
    let heard: string;
    try {
      heard = await this.gemini.transcribe('Kiểm tra lời đọc', wav, TRANSCRIBE_PROMPT);
    } catch {
      return true; // không kiểm tra được thì giữ bản đã tạo
    }
    const sim = similarity(heard, expected);
    const ok = !hasLeadingExtraWords(heard, expected) && sim >= 0.75;
    if (!ok) this.logger.warn(`Lời đọc chưa khớp (giống ${Math.round(sim * 100)}%): nghe "${heard.slice(0, 120)}" / cần "${expected.slice(0, 120)}"`);
    return ok;
  }
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Độ dài đọc ước lượng: số âm tiết + thời gian nghỉ ở dấu câu (tính bằng "âm tiết") */
function speechWeight(text: string) {
  const commas = (text.match(/[,;:]/g) ?? []).length;
  const stops = (text.match(/[.!?…]+/g) ?? []).length;
  return wordCount(text) + commas * 1.2 + stops * 1.8;
}

function isChoppy(job: { text: string }) {
  return (job.text.match(/[,;…]|\.\.\./g) ?? []).length >= 5;
}

function tooSlow(wav: Buffer, text: string) {
  const { sampleRate, samples } = parseWav(wav);
  const ms = (samples.length / sampleRate) * 1000;
  return ms > Math.max(4000, wordCount(text) * 700);
}

/** Bỏ khoảng lặng dài ở đầu/cuối câu đọc riêng */
function trimSilence(wav: Buffer): Buffer {
  const info = parseWav(wav);
  const gaps = findGaps(info);
  return sliceByCuts(info, gaps, [])[0];
}

function words(text: string) {
  return normalizeForTts(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Độ giống nhau theo từ (1 - khoảng cách Levenshtein / độ dài). */
export function similarity(heard: string, expected: string): number {
  const a = words(heard);
  const b = words(expected);
  if (!a.length || !b.length) return a.length === b.length ? 1 : 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** Lời nghe được có chữ thừa đứng trước chữ đầu tiên của câu mong đợi không. */
export function hasLeadingExtraWords(heard: string, expected: string): boolean {
  const h = words(heard);
  const e = words(expected);
  if (!e.length || !h.length) return false;
  // Căn theo 2 chữ đầu của câu mong đợi để tránh trùng ngẫu nhiên
  for (let i = 0; i < Math.min(h.length, 8); i++) {
    if (h[i] === e[0] && (e.length < 2 || h[i + 1] === e[1] || h[i + 2] === e[1])) return i > 0;
  }
  return true; // không thấy phần đầu câu ở vị trí hợp lý: coi như có vấn đề
}
