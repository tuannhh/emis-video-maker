import { Inject, Injectable } from '@nestjs/common';
import { LessonScriptSchema, normalizeForTts, type LessonIdea, type LessonScript } from '@edu/shared';
import { AssetsRepo } from '../core/assets.repo.js';
import { GeminiService } from '../core/gemini.service.js';
import { SCRIPT_SYSTEM, scriptPrompt } from './prompts.js';

@Injectable()
export class ScriptStep {
  constructor(
    @Inject(GeminiService) private readonly gemini: GeminiService,
    @Inject(AssetsRepo) private readonly assets: AssetsRepo,
  ) {}

  async run(idea: LessonIdea, feedback?: string, previous?: LessonScript | null): Promise<LessonScript> {
    const cast = await this.assets.list('character');
    const script = await this.gemini.json('Viết kịch bản', LessonScriptSchema, [
      { text: scriptPrompt(idea, cast, feedback, previous ?? undefined) },
    ], { system: SCRIPT_SYSTEM, temperature: 0.9 });
    return sanitizeScript(script);
  }
}

/** Bảo đảm mọi câu thoại có người nói hợp lệ và ttsText đã được chuẩn hoá. */
export function sanitizeScript(script: LessonScript): LessonScript {
  const ids = new Set(script.characters.map((c) => c.id));
  const fallback = script.characters.find((c) => c.role === 'narrator')?.id ?? script.characters[0].id;
  return {
    ...script,
    sections: script.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => ({
        ...l,
        speaker: ids.has(l.speaker) ? l.speaker : fallback,
        ttsText: normalizeForTts(l.ttsText?.trim() || l.text),
      })),
    })),
  };
}
