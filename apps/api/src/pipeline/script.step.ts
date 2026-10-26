import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  LessonScriptSchema,
  ScriptCharacterSchema,
  ScriptLineSchema,
  ScriptSectionSchema,
  normalizeForTts,
  VOICE_IDS,
  VOICE_YOUTH_IDS,
  type VoiceYouth,
  type Asset,
  type LessonIdea,
  type LessonScript,
  type ScriptCharacter,
  type ScriptLine,
} from '@edu/shared';
import { AssetsRepo } from '../core/assets.repo.js';
import { GeminiService } from '../core/gemini.service.js';
import { UploadsService } from '../core/uploads.service.js';
import { SCRIPT_SYSTEM, scriptPrompt, scriptRevisePrompt } from './prompts.js';

/**
 * Bản sửa kịch bản theo góp ý: chỉ các thao tác trên những câu cần đổi (theo số thứ tự trong kịch bản hiện tại),
 * phần còn lại của kịch bản giữ nguyên từng chữ.
 */
export const ScriptPatchSchema = z.object({
  summary: z.string().describe('Tóm tắt ngắn bằng tiếng Việt những gì đã sửa, ví dụ "Đổi câu [1][2] cho dễ hiểu hơn, thêm 1 câu hỏi"'),
  edits: z
    .array(
      z.object({
        action: z
          .enum(['replace', 'insert', 'delete'])
          .describe('replace = thay câu [section][line]; insert = chèn câu mới NGAY SAU câu [section][line] (line = -1: chèn vào đầu section); delete = xoá câu'),
        section: z.number().int().min(0),
        line: z.number().int().min(-1),
        newLine: ScriptLineSchema.optional().describe('Câu mới đầy đủ các trường (bắt buộc với replace và insert)'),
      }),
    )
    .describe('Các thao tác trên từng câu; câu không có trong danh sách được giữ nguyên'),
  sectionEdits: z
    .array(
      z.object({
        section: z.number().int().min(0),
        heading: z.string().optional(),
        setting: z.string().optional(),
      }),
    )
    .optional()
    .describe('Chỉ khi góp ý yêu cầu đổi tên phần hoặc bối cảnh của phần'),
  addSections: z
    .array(z.object({ after: z.number().int().min(-1).describe('Chèn sau section số này (-1 = đầu bài)'), section: ScriptSectionSchema }))
    .optional()
    .describe('Chỉ khi góp ý yêu cầu thêm hẳn một phần mới'),
  removeSections: z.array(z.number().int().min(0)).optional().describe('Chỉ khi góp ý yêu cầu bỏ hẳn một phần'),
  title: z.string().optional().describe('Chỉ khi góp ý yêu cầu đổi tên bài'),
  recap: z.array(z.string()).optional().describe('Chỉ khi góp ý yêu cầu đổi phần ghi nhớ cuối video'),
  newCharacters: z.array(ScriptCharacterSchema).optional().describe('Chỉ khi góp ý yêu cầu thêm nhân vật mới'),
});
export type ScriptPatch = z.infer<typeof ScriptPatchSchema>;

/** Mã phong cách gắn vào tài sản vẽ theo ảnh tham chiếu phong cách hoặc phong cách có sẵn khác mặc định */
export function styleTag(idea: LessonIdea) {
  if (idea.styleRefId) return `s${idea.styleRefId.replace(/-/g, '').slice(0, 6)}`;
  return idea.artStyle && idea.artStyle !== 'flat' ? `p${idea.artStyle}` : null;
}

/** Tài sản thư viện có cùng phong cách với bài (null = phong cách mặc định) */
export const sameStyle = (asset: Asset, tag: string | null) => (asset.meta.style ?? null) === tag;

/** Mã mới cho tài sản trùng mã thư viện nhưng khác phong cách */
export const restyledKey = (key: string, tag: string | null) => `${key}-${tag ?? 'pflat'}`;

@Injectable()
export class ScriptStep {
  private readonly logger = new Logger(ScriptStep.name);

  constructor(
    @Inject(GeminiService) private readonly gemini: GeminiService,
    @Inject(AssetsRepo) private readonly assets: AssetsRepo,
    @Inject(UploadsService) private readonly uploads: UploadsService,
  ) {}

  /** Đọc tư liệu trước (để báo tiến độ riêng); kết quả được lưu nên lần viết lại không tốn thêm */
  readMaterials(idea: LessonIdea) {
    return this.uploads.materials(idea.materialIds ?? []);
  }

  private async cast(idea: LessonIdea) {
    const library = await this.assets.list('character');
    const byKey = new Map(library.map((a) => [a.key, a]));
    const chosen = (idea.characterKeys ?? []).map((k) => byKey.get(k)).filter((a): a is Asset => !!a);
    const mascot = (idea.mascotKey && byKey.get(idea.mascotKey)) || null;
    if (mascot && !chosen.includes(mascot)) chosen.unshift(mascot);
    return { library, byKey, chosen, mascot, allowNew: idea.newCharacters ?? true, tag: styleTag(idea) };
  }

  /**
   * Sửa kịch bản theo góp ý: AI chỉ trả về thao tác trên những câu cần đổi, máy chủ áp vào kịch bản hiện tại nên mọi
   * câu khác giữ nguyên từng chữ. `scope`: các câu người duyệt đã chọn ("section:line") — chỉ được sửa quanh các câu này.
   */
  async revise(
    idea: LessonIdea,
    script: LessonScript,
    feedback: string,
    scope: string[] = [],
  ): Promise<{ script: LessonScript; summary: string; changed: number }> {
    const { chosen, mascot, allowNew, byKey, tag } = await this.cast(idea);
    const patch = await this.gemini.json(
      'Sửa kịch bản theo góp ý',
      ScriptPatchSchema,
      [{ text: scriptRevisePrompt(idea, script, feedback, scope) }],
      { system: SCRIPT_SYSTEM, temperature: 0.4 },
    );
    const { script: next, applied, dropped } = applyScriptPatch(script, patch, scope);
    if (dropped) this.logger.warn(`Bỏ ${dropped} thao tác nằm ngoài phạm vi người duyệt chọn`);
    const fixed = sanitizeScript(enforceCast(next, { chosen, mascot, allowNew, library: byKey, styleTag: tag }));
    return { script: fixed, summary: patch.summary, changed: applied };
  }

  async run(idea: LessonIdea, feedback?: string, previous?: LessonScript | null): Promise<LessonScript> {
    const { library, byKey, chosen, mascot, allowNew, tag } = await this.cast(idea);
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
    youth: (VOICE_YOUTH_IDS as readonly string[]).includes(a.meta.youth ?? '') ? (a.meta.youth as VoiceYouth) : undefined,
  });
  const chosenKeys = new Set(opts.chosen.map((a) => a.key));
  const rename = new Map<string, string>();
  let characters: ScriptCharacter[] = [];
  for (const c of script.characters) {
    if (chosenKeys.has(c.id)) characters.push(fromAsset(opts.chosen.find((a) => a.key === c.id)!));
    else if (!opts.allowNew && opts.chosen.length) continue;
    else if (c.role !== 'narrator' && opts.library.has(c.id) && !sameStyle(opts.library.get(c.id)!, opts.styleTag)) {
      // Nhân vật cũ cùng mã nhưng khác phong cách: tạo nhân vật mới theo phong cách của bài này
      const id = restyledKey(c.id, opts.styleTag);
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

/**
 * Áp bản sửa vào kịch bản. Thao tác trỏ tới câu/section không tồn tại bị bỏ qua; có `scope` thì chỉ nhận thao tác trên
 * các câu được chọn (hoặc chèn sát cạnh chúng) và không đổi cấu trúc bài.
 */
export function applyScriptPatch(
  script: LessonScript,
  patch: ScriptPatch,
  scope: string[] = [],
): { script: LessonScript; applied: number; dropped: number } {
  const inScope = new Set(scope);
  const scoped = inScope.size > 0;
  const allowed = (e: ScriptPatch['edits'][number]) => {
    if (!scoped) return true;
    if (inScope.has(`${e.section}:${e.line}`)) return true;
    // Chèn ngay trước một câu được chọn (sau câu liền trước nó)
    return e.action === 'insert' && inScope.has(`${e.section}:${e.line + 1}`);
  };
  let applied = 0;
  let dropped = 0;
  const sections = script.sections.map((sec, si) => {
    const edits = patch.edits.filter((e) => e.section === si);
    const replaced = new Map<number, ScriptLine>();
    const deleted = new Set<number>();
    const inserts = new Map<number, ScriptLine[]>();
    for (const e of edits) {
      if (!allowed(e)) {
        dropped++;
        continue;
      }
      const valid = e.action === 'insert' ? e.line >= -1 && e.line < sec.lines.length : e.line >= 0 && e.line < sec.lines.length;
      if (!valid || (e.action !== 'delete' && !e.newLine)) continue;
      applied++;
      if (e.action === 'replace') replaced.set(e.line, e.newLine!);
      else if (e.action === 'delete') deleted.add(e.line);
      else inserts.set(e.line, [...(inserts.get(e.line) ?? []), e.newLine!]);
    }
    const lines: ScriptLine[] = [...(inserts.get(-1) ?? [])];
    sec.lines.forEach((l, li) => {
      if (!deleted.has(li)) lines.push(replaced.get(li) ?? l);
      lines.push(...(inserts.get(li) ?? []));
    });
    const se = scoped ? undefined : patch.sectionEdits?.find((x) => x.section === si);
    if (se?.heading || se?.setting) applied++;
    return {
      ...sec,
      heading: se?.heading?.trim() || sec.heading,
      setting: se?.setting?.trim() || sec.setting,
      // Không để section trống (xoá hết câu): giữ nguyên section cũ
      lines: lines.length ? lines : sec.lines,
    };
  });
  let out = sections;
  if (!scoped) {
    const removed = new Set((patch.removeSections ?? []).filter((i) => i < sections.length));
    if (removed.size >= sections.length) removed.clear();
    applied += removed.size;
    const added = new Map<number, typeof sections>();
    for (const a of patch.addSections ?? []) {
      const at = Math.min(Math.max(-1, a.after), sections.length - 1);
      added.set(at, [...(added.get(at) ?? []), a.section]);
      applied++;
    }
    out = [...(added.get(-1) ?? [])];
    sections.forEach((sec, si) => {
      if (!removed.has(si)) out.push(sec);
      out.push(...(added.get(si) ?? []));
    });
  }
  const ids = new Set(script.characters.map((c) => c.id));
  const newChars = scoped ? [] : (patch.newCharacters ?? []).filter((c) => !ids.has(c.id));
  applied += newChars.length;
  const title = !scoped && patch.title?.trim() ? patch.title.trim() : script.title;
  const recap = !scoped && patch.recap?.length ? patch.recap : script.recap;
  if (title !== script.title) applied++;
  if (recap !== script.recap) applied++;
  return {
    script: { ...script, title, recap, characters: [...script.characters, ...newChars], sections: out },
    applied,
    dropped,
  };
}
