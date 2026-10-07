import { Inject, Injectable } from '@nestjs/common';
import {
  LessonScriptSchema,
  normalizeForTts,
  VOICE_IDS,
  type Asset,
  type LessonIdea,
  type LessonScript,
  type ScriptCharacter,
} from '@edu/shared';
import { AssetsRepo } from '../core/assets.repo.js';
import { GeminiService } from '../core/gemini.service.js';
import { UploadsService } from '../core/uploads.service.js';
import { SCRIPT_SYSTEM, scriptPrompt } from './prompts.js';

/** Mã phong cách gắn vào tài sản vẽ theo ảnh tham chiếu phong cách */
export function styleTag(idea: LessonIdea) {
  return idea.styleRefId ? `s${idea.styleRefId.replace(/-/g, '').slice(0, 6)}` : null;
}

@Injectable()
export class ScriptStep {
  constructor(
    @Inject(GeminiService) private readonly gemini: GeminiService,
    @Inject(AssetsRepo) private readonly assets: AssetsRepo,
    @Inject(UploadsService) private readonly uploads: UploadsService,
  ) {}

  /** Đọc tư liệu trước (để báo tiến độ riêng); kết quả được lưu nên lần viết lại không tốn thêm */
  readMaterials(idea: LessonIdea) {
    return this.uploads.materials(idea.materialIds ?? []);
  }

  async run(idea: LessonIdea, feedback?: string, previous?: LessonScript | null): Promise<LessonScript> {
    const library = await this.assets.list('character');
    const byKey = new Map(library.map((a) => [a.key, a]));
    const chosen = (idea.characterKeys ?? []).map((k) => byKey.get(k)).filter((a): a is Asset => !!a);
    const mascot = (idea.mascotKey && byKey.get(idea.mascotKey)) || null;
    if (mascot && !chosen.includes(mascot)) chosen.unshift(mascot);
    const allowNew = idea.newCharacters ?? true;
    const tag = styleTag(idea);
    const bgLib = new Map((await this.assets.list('background')).map((a) => [a.key, a]));
    const backgrounds = (idea.backgroundKeys ?? []).map((k) => bgLib.get(k)).filter((a): a is Asset => !!a);

    const script = await this.gemini.json(
      'Viết kịch bản',
      LessonScriptSchema,
      [
        {
          text: scriptPrompt(
            idea,
            {
              // Có ảnh phong cách: không gợi ý nhân vật cũ (khác phong cách), chỉ dùng nhân vật đã chọn
              library: tag ? [] : library,
              chosen,
              mascot,
              allowNew,
              backgrounds,
              allowNewBackgrounds: idea.newBackgrounds ?? true,
              materials: await this.readMaterials(idea),
            },
            feedback,
            previous ?? undefined,
          ),
        },
      ],
      { system: SCRIPT_SYSTEM, temperature: 0.9 },
    );
    return sanitizeScript(enforceCast(script, { chosen, mascot, allowNew, library: byKey, styleTag: tag }));
  }
}

/**
 * Bảo đảm kịch bản dùng đúng nhân vật người dùng chọn (giữ nguyên tên, giọng, mô tả để không phải vẽ lại),
 * bỏ nhân vật ngoài danh sách khi không cho phép thêm, và đổi mã nhân vật mới trùng thư viện khi vẽ theo phong cách khác.
 */
export function enforceCast(
  script: LessonScript,
  opts: { chosen: Asset[]; mascot: Asset | null; allowNew: boolean; library: Map<string, Asset>; styleTag: string | null },
): LessonScript {
  const fromAsset = (a: Asset): ScriptCharacter => ({
    id: a.key,
    name: a.name,
    role: (['child', 'adult', 'mascot'].includes(a.meta.role ?? '') ? a.meta.role : 'mascot') as ScriptCharacter['role'],
    description: a.description,
    voice: (VOICE_IDS as readonly string[]).includes(a.meta.voice ?? '') ? (a.meta.voice as ScriptCharacter['voice']) : 'Zephyr',
  });
  const chosenKeys = new Set(opts.chosen.map((a) => a.key));
  const rename = new Map<string, string>();
  let characters: ScriptCharacter[] = [];
  for (const c of script.characters) {
    if (chosenKeys.has(c.id)) characters.push(fromAsset(opts.chosen.find((a) => a.key === c.id)!));
    else if (!opts.allowNew && opts.chosen.length) continue;
    else if (opts.styleTag && c.role !== 'narrator' && opts.library.has(c.id)) {
      // Nhân vật cũ cùng mã nhưng khác phong cách: tạo nhân vật mới theo phong cách của bài này
      const id = `${c.id}-${opts.styleTag}`;
      rename.set(c.id, id);
      characters.push({ ...c, id });
    } else characters.push(c);
  }
  for (const a of opts.chosen) if (!characters.some((c) => c.id === a.key)) characters.push(fromAsset(a));
  if (!characters.length) characters = script.characters;

  // Câu của nhân vật bị bỏ chuyển cho mascot (hoặc nhân vật đã chọn đầu tiên)
  const keep = new Set(characters.map((c) => c.id));
  const host = opts.mascot?.key ?? opts.chosen[0]?.key ?? characters[0].id;
  return {
    ...script,
    characters,
    sections: script.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => {
        const speaker = rename.get(l.speaker) ?? l.speaker;
        return { ...l, speaker: keep.has(speaker) ? speaker : host };
      }),
    })),
  };
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
