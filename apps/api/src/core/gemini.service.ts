import fs from 'node:fs';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { GoogleGenAI, type Part } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import { config } from './config.js';
import { AGENT_PLATFORM, agentUrl, geminiPlatform } from './gemini-platform.js';
import { SettingsService } from './settings.service.js';
import { UsageService, type GeminiUsageMetadata } from './usage.service.js';

const REST = 'https://generativelanguage.googleapis.com/v1beta/models';
const AGENT = AGENT_PLATFORM;
const SIZES = ['1K', '2K', '4K'];

/**
 * Đường gọi một model: `agent` = Agent Platform (service account), `key` = Developer API (API key).
 * Agent Platform là đường chính; dịch vụ nó chưa có thì gọi bằng key phụ.
 */
type Via = 'agent' | 'key';
/** Model chỉ có trên Developer API */
const KEY_ONLY = /^lyria-3/;
/** Agent Platform báo model không tồn tại hoặc chưa mở cho project */
const MISSING = /\b404\b|NOT_FOUND|was not found|is not found|not supported/i;

/** Một đoạn lời cho TTS; `style` đi qua speechMetadata.style nên không bị đọc thành tiếng */
export interface SpeechPart {
  text: string;
  style?: string;
}

export class GeminiError extends Error {}

/** Kết quả bị bộ lọc an toàn của Gemini chặn (đôi khi chặn nhầm, thử lại thường qua) */
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY', 'OTHER']);
export const BLOCKED_MESSAGE = 'bị bộ lọc an toàn của Gemini chặn';

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
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);
  private readonly imageSlots = new Semaphore(4);
  private agentSdk: GoogleGenAI | null = null;
  private keySdk: { key: string; ai: GoogleGenAI } | null = null;
  /** Model Agent Platform báo không có (phát hiện lúc chạy): từ đó gọi thẳng bằng key phụ */
  private readonly keyOnly = new Set<string>();
  /** Agent Platform: thư viện tự đổi file khoá lấy access token và làm mới trước khi hết hạn */
  private readonly auth = AGENT ? new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }) : null;

  constructor(
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    const p = geminiPlatform();
    this.logger.log(
      p.provider === 'agent-platform'
        ? `AI: Gemini Enterprise Agent Platform (${p.project}/${p.location}, ${p.account ?? 'service account của môi trường chạy'})`
        : 'AI: Gemini Developer API (API key)',
    );
  }

  /** Key do admin nhập trên trang Cài đặt (đổi key không cần khởi động lại) */
  private async key() {
    const key = await this.settings.geminiKey();
    if (!key) throw new GeminiError('Chưa có Gemini API key: admin vào trang Cài đặt để nhập key');
    return key;
  }

  private async hasKey() {
    return !!(await this.settings.geminiKey());
  }

  private via(model: string): Via {
    return AGENT && !KEY_ONLY.test(model) && !this.keyOnly.has(model) ? 'agent' : 'key';
  }

  /**
   * Chạy `fn` theo đường của model. Agent Platform báo không có model mà admin đã nhập key thì chuyển sang
   * Developer API và nhớ lại cho các lần sau (đến khi khởi động lại).
   */
  private async routed<T>(model: string, fn: (via: Via) => Promise<T>): Promise<T> {
    const via = this.via(model);
    try {
      return await fn(via);
    } catch (err) {
      if (via !== 'agent' || !MISSING.test((err as Error).message) || !(await this.hasKey())) throw err;
      this.keyOnly.add(model);
      this.logger.warn(`${model}: Agent Platform chưa có model này, chuyển sang Gemini API key`);
      return fn('key');
    }
  }

  private async ai(via: Via) {
    if (via === 'agent') {
      const { project, location } = config.gemini;
      return (this.agentSdk ??= new GoogleGenAI({ vertexai: true, project, location }));
    }
    const key = await this.key();
    if (this.keySdk?.key !== key) this.keySdk = { key, ai: new GoogleGenAI({ apiKey: key }) };
    return this.keySdk.ai;
  }

  /** Gọi REST trực tiếp (SDK hiện bỏ mất speechMetadata của từng part). */
  private async rest(via: Via, model: string, body: unknown, verb = 'generateContent', location?: string): Promise<any> {
    const agent = via === 'agent';
    const res = await fetch(agent ? agentUrl(model, verb, location) : `${REST}/${model}:${verb}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(agent ? { authorization: `Bearer ${await this.auth!.getAccessToken()}` } : { 'x-goog-api-key': await this.key() }),
      },
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
    let blocked = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const model = opts.model ?? config.gemini.textModel;
      const res = await this.routed(model, (via) =>
        this.withRetry(label, async () =>
          (await this.ai(via)).models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: opts.system,
              temperature: opts.temperature ?? 0.8,
              responseMimeType: 'application/json',
              responseJsonSchema,
            },
          }),
        ),
      );
      await this.usage.record(model, label, res.usageMetadata as GeminiUsageMetadata);
      const text = res.text ?? '';
      const finish = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason;
      blocked = !text && !!finish && BLOCKED.has(finish);
      if (blocked) {
        this.logger.warn(`${label}: ${BLOCKED_MESSAGE} (${finish}), thử lại`);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      const problem =
        parsed === undefined
          ? `JSON không hợp lệ (${text.length} ký tự, kết thúc: ${finish}): …${text.slice(-160)}`
          : z.prettifyError(result.error);
      this.logger.warn(`${label}: kết quả sai định dạng, yêu cầu sửa lại. ${problem.slice(0, 300)}`);
      contents = [
        ...contents,
        { role: 'model', parts: [{ text }] },
        { role: 'user', parts: [{ text: `Kết quả chưa đúng schema:\n${problem}\nHãy trả lại toàn bộ JSON đã sửa.` }] },
      ];
    }
    throw new GeminiError(blocked ? `${label}: ${BLOCKED_MESSAGE}` : `${label}: model trả về dữ liệu sai định dạng`);
  }

  /**
   * Tạo hoặc chỉnh sửa ảnh. `images` là ảnh tham chiếu (ví dụ ảnh gốc của nhân vật).
   * `hq`: ảnh vẽ một lần rồi dùng lại lâu dài (thiết kế nhân vật, bối cảnh) dùng model chất lượng cao.
   */
  async image(
    label: string,
    prompt: string,
    opts: { aspectRatio: string; images?: Buffer[]; imageSize?: string; hq?: boolean },
  ): Promise<Buffer> {
    const parts: Part[] = [
      ...(opts.images ?? []).map((b) => ({ inlineData: { mimeType: 'image/png', data: b.toString('base64') } })),
      { text: prompt },
    ];
    const model = opts.hq ? config.gemini.imageModelHq : config.gemini.imageModel;
    return this.routed(model, (via) => this.withRetry(label, () => this.imageSlots.run(async () => {
      const res = await (await this.ai(via)).models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: opts.aspectRatio, imageSize: imageSize(model, opts.imageSize ?? '2K') },
        },
      });
      await this.usage.record(model, label, res.usageMetadata as GeminiUsageMetadata, 'IMAGE');
      const img = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!img?.inlineData?.data) {
        const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? 'không rõ';
        throw new GeminiError(`${label}: model không trả về ảnh (${reason})`);
      }
      return Buffer.from(img.inlineData.data, 'base64');
    }), 4));
  }

  /**
   * Đọc một hoặc nhiều đoạn lời bằng một giọng trong CÙNG một request để giọng và vùng miền nhất quán.
   * Trả về WAV (mono 16-bit).
   */
  async speech(label: string, parts: SpeechPart[], voice: string): Promise<Buffer> {
    const model = config.gemini.ttsModel;
    return this.routed(model, (via) => this.withRetry(label, async () => {
      const res = await this.rest(via, model, {
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
    }));
  }

  /**
   * Sáng tác nhạc nền bằng Lyria. Trả về file âm thanh (thường là MP3).
   * Agent Platform chưa có Lyria 3.x: gọi bằng key phụ; không có key hoặc key lỗi thì dùng lyria-002 trên Agent Platform.
   */
  async music(label: string, prompt: string): Promise<{ audio: Buffer; mimeType: string }> {
    const { musicModel, musicFallback } = config.gemini;
    const main = this.via(musicModel);
    if (main === 'agent' || !AGENT) return this.compose(label, prompt, musicModel, main);
    if (await this.hasKey()) {
      try {
        return await this.compose(label, prompt, musicModel, 'key');
      } catch (err) {
        this.logger.warn(`${label}: ${musicModel} qua API key lỗi, dùng ${musicFallback} (${(err as Error).message.slice(0, 160)})`);
      }
    }
    return this.compose(label, prompt, musicFallback, 'agent');
  }

  private compose(label: string, prompt: string, model: string, via: Via): Promise<{ audio: Buffer; mimeType: string }> {
    return this.withRetry(
      label,
      async () => {
        if (/^lyria-0/.test(model)) {
          // Lyria đời cũ (Agent Platform): API predict, trả WAV stereo 48 kHz ~30 giây
          const res = await this.rest(via, model, { instances: [{ prompt }], parameters: {} }, 'predict', config.gemini.musicLocation);
          await this.usage.record(model, label, {}, 'AUDIO');
          const data = res.predictions?.[0]?.bytesBase64Encoded;
          if (!data) throw new GeminiError(`${label}: model không trả về âm thanh`);
          return { audio: Buffer.from(data, 'base64'), mimeType: String(res.predictions[0].mimeType ?? 'audio/wav') };
        }
        const res = await this.rest(via, model, {
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

  /** Trả lời dạng văn bản tự do (đọc tài liệu, OCR, viết mô tả). */
  async text(label: string, parts: Part[], opts: { system?: string; temperature?: number } = {}): Promise<string> {
    const model = config.gemini.textModel;
    const res = await this.routed(model, (via) =>
      this.withRetry(label, async () =>
        (await this.ai(via)).models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: { systemInstruction: opts.system, temperature: opts.temperature ?? 0.2 },
        }),
      ),
    );
    await this.usage.record(model, label, res.usageMetadata as GeminiUsageMetadata);
    const text = (res.text ?? '').trim();
    const finish = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason;
    if (!text && finish && BLOCKED.has(finish)) throw new GeminiError(`${label}: ${BLOCKED_MESSAGE}`);
    return text;
  }

  /** Chép lời một đoạn âm thanh (dùng để kiểm tra TTS có đọc nhầm chỉ dẫn không). */
  async transcribe(label: string, wav: Buffer, prompt: string): Promise<string> {
    const model = config.gemini.textModel;
    const res = await this.routed(model, (via) =>
      this.withRetry(label, async () =>
        (await this.ai(via)).models.generateContent({
          model,
          contents: [
            { role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }, { text: prompt }] },
          ],
          config: { temperature: 0 },
        }),
      ),
    );
    await this.usage.record(model, label, res.usageMetadata as GeminiUsageMetadata);
    return (res.text ?? '').trim();
  }

  /**
   * Phần video gửi kèm câu hỏi. Developer API: tải lên Files API rồi xoá bằng `done`.
   * Agent Platform không có Files API: gửi thẳng dữ liệu video trong request.
   */
  async videoPart(filePath: string): Promise<{ part: Part; done: () => Promise<void> }> {
    if (this.via(config.gemini.textModel) === 'agent') {
      const data = (await fs.promises.readFile(filePath)).toString('base64');
      return { part: { inlineData: { mimeType: 'video/mp4', data } }, done: async () => undefined };
    }
    const file = await this.uploadVideo(filePath);
    return { part: { fileData: { fileUri: file.uri!, mimeType: 'video/mp4' } }, done: () => this.deleteFile(file.name!) };
  }

  /** Tải video lên Gemini Files API và chờ xử lý xong. */
  private async uploadVideo(filePath: string) {
    const ai = await this.ai('key');
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

  private async deleteFile(name: string) {
    await (await this.ai('key')).files.delete({ name }).catch(() => undefined);
  }
}

/** Cỡ ảnh không vượt quá mức model hỗ trợ (bản Lite chỉ vẽ 1K) */
function imageSize(model: string, wanted: string) {
  const max = SIZES.indexOf(/lite/.test(model) ? '1K' : '4K');
  const i = SIZES.indexOf(wanted);
  return i > max ? SIZES[max] : wanted;
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
