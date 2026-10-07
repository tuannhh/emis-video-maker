import { Inject, Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI, type Part } from '@google/genai';
import { z } from 'zod';
import { config } from './config.js';
import { SettingsService } from './settings.service.js';
import { UsageService, type GeminiUsageMetadata } from './usage.service.js';

const REST = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Một đoạn lời cho TTS; `style` đi qua speechMetadata.style nên không bị đọc thành tiếng */
export interface SpeechPart {
  text: string;
  style?: string;
}

export class GeminiError extends Error {}

/** Giới hạn số request đồng thời (model ảnh dễ bị 429 khi vẽ nhiều dáng nhân vật cùng lúc) */
class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const RETRYABLE = /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE|fetch failed|ECONNRESET|ETIMEDOUT/i;

/** Bỏ các từ khoá JSON Schema mà Gemini không cần; dữ liệu trả về vẫn được zod kiểm tra lại. */
function toGeminiSchema(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as Record<string, unknown>;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === '$schema' || k === 'pattern' || k === 'additionalProperties') continue;
        out[k] = strip(v);
      }
      return out;
    }
    return node;
  };
  return strip(json);
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly imageSlots = new Semaphore(4);
  private sdk: { key: string; ai: GoogleGenAI } | null = null;

  constructor(
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Key do admin nhập trên trang Cài đặt (đổi key không cần khởi động lại) */
  private async key() {
    const key = await this.settings.geminiKey();
    if (!key) throw new GeminiError('Chưa có Gemini API key: admin vào trang Cài đặt để nhập key');
    return key;
  }

  private async ai() {
    const key = await this.key();
    if (this.sdk?.key !== key) this.sdk = { key, ai: new GoogleGenAI({ apiKey: key }) };
    return this.sdk.ai;
  }

  /** Gọi REST trực tiếp (SDK hiện bỏ mất speechMetadata của từng part). */
  private async rest(model: string, body: unknown): Promise<any> {
    const res = await fetch(`${REST}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': await this.key() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    if (!res.ok) throw new GeminiError(`${res.status} ${text.slice(0, 400)}`);
    return JSON.parse(text);
  }

  async withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!RETRYABLE.test(msg) || i === attempts - 1) break;
        const wait = Math.min(30_000, 2000 * 2 ** i) + Math.random() * 1000;
        this.logger.warn(`${label}: lỗi tạm thời, thử lại sau ${Math.round(wait / 1000)}s (${msg.slice(0, 160)})`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new GeminiError(`${label} thất bại: ${msg.slice(0, 500)}`);
  }

  /** Gọi model văn bản với JSON schema, kiểm tra kết quả bằng zod; sai định dạng thì hỏi lại một lần. */
  async json<S extends z.ZodType>(
    label: string,
    schema: S,
    parts: Part[],
    opts: { system?: string; temperature?: number; model?: string } = {},
  ): Promise<z.infer<S>> {
    const responseJsonSchema = toGeminiSchema(schema);
    let contents = [{ role: 'user', parts }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const model = opts.model ?? config.gemini.textModel;
      const res = await this.withRetry(label, async () =>
        (await this.ai()).models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: opts.system,
            temperature: opts.temperature ?? 0.8,
            responseMimeType: 'application/json',
            responseJsonSchema,
          },
        }),
      );
      await this.usage.record(model, label, res.usageMetadata as GeminiUsageMetadata);
      const text = res.text ?? '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      const problem = parsed === undefined ? 'JSON không hợp lệ' : z.prettifyError(result.error);
      this.logger.warn(`${label}: kết quả sai định dạng, yêu cầu sửa lại. ${problem.slice(0, 300)}`);
      contents = [
        ...contents,
        { role: 'model', parts: [{ text }] },
        { role: 'user', parts: [{ text: `Kết quả chưa đúng schema:\n${problem}\nHãy trả lại toàn bộ JSON đã sửa.` }] },
      ];
    }
    throw new GeminiError(`${label}: model trả về dữ liệu sai định dạng`);
  }

  /** Tạo hoặc chỉnh sửa ảnh. `images` là ảnh tham chiếu (ví dụ ảnh gốc của nhân vật). */
  async image(
    label: string,
    prompt: string,
    opts: { aspectRatio: string; images?: Buffer[]; imageSize?: string },
  ): Promise<Buffer> {
    const parts: Part[] = [
      ...(opts.images ?? []).map((b) => ({ inlineData: { mimeType: 'image/png', data: b.toString('base64') } })),
      { text: prompt },
    ];
    return this.withRetry(label, () => this.imageSlots.run(async () => {
      const res = await (await this.ai()).models.generateContent({
        model: config.gemini.imageModel,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: opts.aspectRatio, imageSize: opts.imageSize ?? '2K' },
        },
      });
      await this.usage.record(config.gemini.imageModel, label, res.usageMetadata as GeminiUsageMetadata, 'IMAGE');
      const img = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!img?.inlineData?.data) {
        const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? 'không rõ';
        throw new GeminiError(`${label}: model không trả về ảnh (${reason})`);
      }
      return Buffer.from(img.inlineData.data, 'base64');
    }), 4);
  }

  /**
   * Đọc một hoặc nhiều đoạn lời bằng một giọng trong CÙNG một request để giọng và vùng miền nhất quán.
   * Trả về WAV (mono 16-bit).
   */
  async speech(label: string, parts: SpeechPart[], voice: string): Promise<Buffer> {
    const model = config.gemini.ttsModel;
    return this.withRetry(label, async () => {
      const res = await this.rest(model, {
        contents: [
          {
            role: 'user',
            parts: parts.map((p) => (p.style ? { text: p.text, speechMetadata: { style: p.style } } : { text: p.text })),
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      });
      await this.usage.record(model, label, res.usageMetadata, 'AUDIO');
      const audio = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
      if (!audio?.data) throw new GeminiError(`${label}: model không trả về âm thanh`);
      const buf = Buffer.from(audio.data, 'base64');
      if (buf.subarray(0, 4).toString('ascii') === 'RIFF') return buf;
      // Một số model trả PCM thô (audio/L16;rate=24000)
      const rate = Number(/rate=(\d+)/.exec(audio.mimeType ?? '')?.[1] ?? 24000);
      return pcmToWav(buf, rate);
    });
  }

  /** Sáng tác nhạc nền bằng Lyria. Trả về file âm thanh (thường là MP3). */
  async music(label: string, prompt: string): Promise<{ audio: Buffer; mimeType: string }> {
    const model = config.gemini.musicModel;
    return this.withRetry(
      label,
      async () => {
        const res = await this.rest(model, {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['AUDIO'] },
        });
        await this.usage.record(model, label, res.usageMetadata, 'AUDIO');
        const audio = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
        if (!audio?.data) throw new GeminiError(`${label}: model không trả về âm thanh`);
        return {
          audio: Buffer.from(audio.data, 'base64'),
          mimeType: String(audio.mimeType ?? 'audio/mpeg').split(';')[0],
        };
      },
      3,
    );
  }

  /** Chép lời một đoạn âm thanh (dùng để kiểm tra TTS có đọc nhầm chỉ dẫn không). */
  async transcribe(label: string, wav: Buffer, prompt: string): Promise<string> {
    const res = await this.withRetry(label, async () =>
      (await this.ai()).models.generateContent({
        model: config.gemini.textModel,
        contents: [
          { role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }, { text: prompt }] },
        ],
        config: { temperature: 0 },
      }),
    );
    await this.usage.record(config.gemini.textModel, label, res.usageMetadata as GeminiUsageMetadata);
    return (res.text ?? '').trim();
  }

  /** Tải video lên Gemini Files API và chờ xử lý xong. */
  async uploadVideo(filePath: string) {
    const ai = await this.ai();
    let file = await this.withRetry('Tải video lên Gemini', () =>
      ai.files.upload({ file: filePath, config: { mimeType: 'video/mp4' } }),
    );
    const started = Date.now();
    while (file.state === 'PROCESSING') {
      if (Date.now() - started > 5 * 60_000) throw new GeminiError('Gemini xử lý video quá lâu');
      await new Promise((r) => setTimeout(r, 4000));
      file = await ai.files.get({ name: file.name! });
    }
    if (file.state === 'FAILED') throw new GeminiError('Gemini không xử lý được video');
    return file;
  }

  async deleteFile(name: string) {
    await (await this.ai()).files.delete({ name }).catch(() => undefined);
  }
}

export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
