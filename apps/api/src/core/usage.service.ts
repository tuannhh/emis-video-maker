import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { UsageRow, UsageSummary } from '@edu/shared';
import { DbService } from './db.service.js';

/**
 * Ngữ cảnh của lượt gọi Gemini: thuộc bài học nào, bước nào.
 * Pipeline bọc mỗi job trong `usageContext.run(...)`; GeminiService tự đọc để ghi token.
 */
export interface UsageContext {
  lessonId: string | null;
  step: string;
}
export const usageContext = new AsyncLocalStorage<UsageContext>();

/** usageMetadata trả về từ Gemini API (camelCase, giống SDK và REST) */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
  promptTokensDetails?: { modality?: string; tokenCount?: number }[];
  candidatesTokensDetails?: { modality?: string; tokenCount?: number }[];
}

/**
 * Bảng giá USD / 1 triệu token, khai báo qua biến môi trường GEMINI_PRICING (JSON), ví dụ:
 * {"gemini-3.8-flash": {"input": 0.5, "output": 3, "input_audio": 1},
 *  "gemini-3.8-flash-tts": {"input": 0.5, "output_audio": 10}}
 * Khoá theo loại dữ liệu: input_text/input_image/input_audio/input_video, output_text/output_image/output_audio;
 * thiếu thì dùng "input"/"output". Token suy luận (thoughts) tính theo giá output_text.
 * "request": giá USD mỗi lượt gọi, cho model tính tiền theo lượt (Lyria tính theo bài nhạc).
 */
type Price = Record<string, number>;

function loadPricing(): Record<string, Price> {
  const raw = process.env.GEMINI_PRICING;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, Price>;
  } catch {
    new Logger('Usage').warn('GEMINI_PRICING không phải JSON hợp lệ, bỏ qua');
    return {};
  }
}

function detail(list: GeminiUsageMetadata['promptTokensDetails']) {
  const out: Record<string, number> = {};
  for (const d of list ?? []) {
    const k = (d.modality ?? 'TEXT').toUpperCase();
    out[k] = (out[k] ?? 0) + (d.tokenCount ?? 0);
  }
  return out;
}

function add(into: Record<string, number>, from: Record<string, number>) {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);
  private readonly pricing = loadPricing();

  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Ghi lại token của một lượt gọi. Không bao giờ làm hỏng pipeline nếu ghi lỗi. */
  async record(model: string, label: string, usage: GeminiUsageMetadata | undefined, outputModality = 'TEXT') {
    if (!usage) return;
    const ctx = usageContext.getStore();
    const input = detail(usage.promptTokensDetails);
    const output = detail(usage.candidatesTokensDetails);
    const prompt = usage.promptTokenCount ?? 0;
    const candidates = usage.candidatesTokenCount ?? 0;
    // Một số model (TTS, Lyria) không trả chi tiết theo loại: gán theo loại đầu ra mong đợi
    if (!Object.keys(input).length && prompt) input.TEXT = prompt;
    if (!Object.keys(output).length && candidates) output[outputModality] = candidates;
    const thoughts = usage.thoughtsTokenCount ?? 0;
    try {
      await this.db.query(
        `insert into gemini_usage (lesson_id, step, label, model, prompt_tokens, output_tokens, thoughts_tokens,
           cached_tokens, total_tokens, input_detail, output_detail)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          ctx?.lessonId ?? null,
          ctx?.step ?? 'other',
          label,
          model,
          prompt,
          candidates,
          thoughts,
          usage.cachedContentTokenCount ?? 0,
          usage.totalTokenCount ?? prompt + candidates + thoughts,
          JSON.stringify(input),
          JSON.stringify(output),
        ],
      );
    } catch (err) {
      this.logger.warn(`Không ghi được token: ${(err as Error).message}`);
    }
  }

  private cost(
    model: string,
    input: Record<string, number>,
    output: Record<string, number>,
    thoughts: number,
    outputTotal: number,
    calls: number,
  ) {
    const p = this.pricing[model];
    if (!p) return null;
    const price = (dir: 'input' | 'output', modality: string) => p[`${dir}_${modality.toLowerCase()}`] ?? p[dir] ?? 0;
    let usd = calls * (p.request ?? 0);
    for (const [m, n] of Object.entries(input)) usd += (n * price('input', m)) / 1e6;
    for (const [m, n] of Object.entries(output)) usd += (n * price('output', m)) / 1e6;
    // Phần đầu ra không được liệt kê theo loại (model ảnh trả kèm chữ nhưng chỉ báo chi tiết phần ảnh) tính giá chữ
    const listed = Object.values(output).reduce((a, b) => a + b, 0);
    usd += (Math.max(0, outputTotal - listed) * price('output', 'text')) / 1e6;
    usd += (thoughts * price('output', 'text')) / 1e6;
    return usd;
  }

  /** Tổng token của một bài học (mọi lần chạy, kể cả làm lại), hoặc toàn hệ thống nếu lessonId = null. */
  async summary(lessonId: string | null): Promise<UsageSummary> {
    const rows = await this.db.query(
      `select model, step, count(*)::int as calls,
              sum(prompt_tokens)::bigint as prompt, sum(output_tokens)::bigint as output,
              sum(thoughts_tokens)::bigint as thoughts, sum(cached_tokens)::bigint as cached,
              sum(total_tokens)::bigint as total,
              jsonb_agg(input_detail) as inputs, jsonb_agg(output_detail) as outputs
         from gemini_usage
        where ($1::uuid is null or lesson_id = $1)
        group by model, step`,
      [lessonId],
    );

    const byModel = new Map<string, UsageRow>();
    const byStep = new Map<string, { step: string; calls: number; totalTokens: number; costUsd: number | null }>();
    let pricingComplete = true;

    for (const r of rows) {
      const input: Record<string, number> = {};
      const output: Record<string, number> = {};
      for (const d of r.inputs as Record<string, number>[]) add(input, d);
      for (const d of r.outputs as Record<string, number>[]) add(output, d);
      const thoughts = Number(r.thoughts);
      const cost = this.cost(r.model, input, output, thoughts, Number(r.output), Number(r.calls));
      if (cost === null) pricingComplete = false;

      const m = byModel.get(r.model) ?? {
        model: r.model,
        step: '',
        calls: 0,
        promptTokens: 0,
        outputTokens: 0,
        thoughtsTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        input: {},
        output: {},
        costUsd: 0 as number | null,
      };
      m.calls += r.calls;
      m.promptTokens += Number(r.prompt);
      m.outputTokens += Number(r.output);
      m.thoughtsTokens += thoughts;
      m.cachedTokens += Number(r.cached);
      m.totalTokens += Number(r.total);
      add(m.input, input);
      add(m.output, output);
      m.costUsd = m.costUsd === null || cost === null ? null : m.costUsd + cost;
      byModel.set(r.model, m);

      const s = byStep.get(r.step) ?? { step: r.step, calls: 0, totalTokens: 0, costUsd: 0 as number | null };
      s.calls += r.calls;
      s.totalTokens += Number(r.total);
      s.costUsd = s.costUsd === null || cost === null ? null : s.costUsd + cost;
      byStep.set(r.step, s);
    }

    const models = [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens);
    const known = models.filter((m) => m.costUsd !== null);
    return {
      totalTokens: models.reduce((a, m) => a + m.totalTokens, 0),
      promptTokens: models.reduce((a, m) => a + m.promptTokens, 0),
      outputTokens: models.reduce((a, m) => a + m.outputTokens, 0),
      thoughtsTokens: models.reduce((a, m) => a + m.thoughtsTokens, 0),
      calls: models.reduce((a, m) => a + m.calls, 0),
      costUsd: known.length ? known.reduce((a, m) => a + (m.costUsd ?? 0), 0) : null,
      pricingComplete: pricingComplete && models.length > 0,
      byModel: models,
      byStep: [...byStep.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    };
  }

  /** Tổng token theo từng bài (cho danh sách) */
  async totalsByLesson(): Promise<Record<string, number>> {
    const rows = await this.db.query(
      `select lesson_id, sum(total_tokens)::bigint as total from gemini_usage where lesson_id is not null group by lesson_id`,
    );
    return Object.fromEntries(rows.map((r) => [r.lesson_id, Number(r.total)]));
  }
}
