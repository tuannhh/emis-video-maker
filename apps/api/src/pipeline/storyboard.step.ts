import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_SHOT_ILLUSTRATIONS,
  STORYBOARD_VERSION,
  ShotIllustrationSchema,
  ShotSchema,
  StoryboardSceneSchema,
  StoryboardSchema,
  shotIllustrations,
  type Asset,
  type LessonIdea,
  type LessonScript,
  type Relation,
  type Shot,
  type ShotIllustration,
  type Storyboard,
  type StoryboardBackground,
  type StoryboardScene,
} from '@edu/shared';
import { z } from 'zod';
import { AssetsRepo } from '../core/assets.repo.js';
import { GeminiService } from '../core/gemini.service.js';
import { STORYBOARD_SYSTEM, storyboardPrompt, type StagingScope } from './prompts.js';
import { restyledKey, sameStyle, styleTag } from './script.step.js';
import { sha1 } from './util.js';

/** Dấu vân tay nội dung một section: đổi bối cảnh, người nói hay lời thoại thì section đó phải dàn dựng lại */
export function sectionPrint(section: LessonScript['sections'][number]) {
  return sha1(section.setting, ...section.lines.map((l) => `${l.speaker}|${l.text}`));
}

/**
 * Schema gửi cho AI: `illustrations` bắt buộc có mặt ở mọi shot (được để []). Khi để tuỳ chọn, AI thường bỏ qua cả trường
 * dù đã định minh hoạ (đo thực tế: 1/4 lần có hình cho bài vị trí trên/dưới); bắt buộc thì AI phải cân nhắc từng câu.
 */
const AiShotSchema = ShotSchema.extend({
  illustrations: z
    .array(ShotIllustrationSchema)
    .max(MAX_SHOT_ILLUSTRATIONS)
    .describe(
      'Hình minh hoạ bật ra cạnh nhân vật đúng lúc lời thoại nhắc tới sự vật/con vật/hình ảnh so sánh mà nền không có; ' +
        'câu nói vị trí giữa các vật thì BẮT BUỘC có cả vật mốc và vật kia (relation). Để [] khi câu không cần hình.',
    ),
});
const AiStoryboardSchema = StoryboardSchema.extend({
  scenes: z.array(StoryboardSceneSchema.extend({ shots: z.array(AiShotSchema).min(1) })).min(1),
});

/** Kết quả AI sửa storyboard theo góp ý: chỉ các scene cần đổi */
const RevisionSchema = AiStoryboardSchema.extend({
  summary: z.string().describe('Tóm tắt ngắn bằng tiếng Việt những gì đã dựng lại'),
});

const POSITIONS = ['left', 'right', 'center'] as const;
type Position = (typeof POSITIONS)[number];
const MAX_CLOSEUPS = 2;
/** Số hình minh hoạ khác nhau tối đa mỗi bài (mỗi hình mới tốn 1 lần vẽ, hình đã có trong thư viện thì dùng lại) */
export const MAX_ILLUSTRATIONS = 16;
const TIGHT = new Set(['medium', 'close-up']);

@Injectable()
export class StoryboardStep {
  constructor(
    @Inject(GeminiService) private readonly gemini: GeminiService,
    @Inject(AssetsRepo) private readonly assets: AssetsRepo,
  ) {}

  async run(script: LessonScript, feedback: string | null | undefined, idea: LessonIdea): Promise<Storyboard> {
    const ctx = await this.context(idea);
    const board = await this.gemini.json('Dàn dựng cảnh', AiStoryboardSchema, [
      { text: storyboardPrompt(script, ctx.library, feedback, ctx.chosen) },
    ], { system: STORYBOARD_SYSTEM, temperature: 0.6 });
    return this.finish(board, script, ctx);
  }

  /**
   * Kịch bản đã sửa sau lần dàn dựng trước: section nào nội dung không đổi thì giữ nguyên scene cũ (cùng nền, cùng cách
   * dựng), chỉ nhờ AI dàn dựng các section mới hoặc đã đổi. Trả về null nếu không có gì đổi.
   */
  async reconcile(script: LessonScript, board: Storyboard, idea: LessonIdea): Promise<{ board: Storyboard; restaged: number[] } | null> {
    const prints = script.sections.map(sectionPrint);
    const old = board.sections;
    if (!old || old.length !== board.scenes.length) return { board: await this.run(script, null, idea), restaged: prints.map((_, i) => i) };
    const used = new Set<number>();
    const kept = new Map<number, StoryboardScene>();
    prints.forEach((p, si) => {
      const oi = old.findIndex((o, k) => o === p && !used.has(k));
      if (oi < 0) return;
      used.add(oi);
      kept.set(si, { ...board.scenes[oi], sectionIndex: si });
    });
    const stale = prints.map((_, i) => i).filter((i) => !kept.has(i));
    if (!stale.length && prints.length === old.length && prints.every((p, i) => p === old[i])) return null;
    const ctx = await this.context(idea);
    // Chỉ đổi thứ tự / xoá section: không cần AI
    if (!stale.length) return { board: this.merge(board, { backgrounds: [], scenes: [] }, script, kept, [], ctx), restaged: [] };
    // Section đã đổi: đưa cách dựng cũ (cùng vị trí) làm tham khảo để giữ nền và chỗ đứng
    const reference = stale
      .map((si) => (!used.has(si) && board.scenes[si] ? { section: si, scene: board.scenes[si] } : null))
      .filter((r): r is { section: number; scene: StoryboardScene } => !!r);
    const scope: StagingScope = { sections: stale, reference, kept: [...kept.values()], keptBackgrounds: board.backgrounds };
    const fresh = await this.gemini.json('Dàn dựng phần đã sửa', AiStoryboardSchema, [
      { text: storyboardPrompt(script, ctx.library, null, ctx.chosen, scope) },
    ], { system: STORYBOARD_SYSTEM, temperature: 0.5 });
    return { board: this.merge(board, fresh, script, kept, stale, ctx), restaged: stale };
  }

  /**
   * Người duyệt góp ý về video: AI chỉ dàn dựng lại các scene liên quan tới góp ý, các scene khác giữ nguyên.
   * `timing`: thời điểm từng câu trong video trước (góp ý kiểu "ở giây 0:42...").
   */
  async revise(
    script: LessonScript,
    board: Storyboard,
    feedback: string,
    idea: LessonIdea,
    timing: string | null,
  ): Promise<{ board: Storyboard; restaged: number[]; summary: string }> {
    const ctx = await this.context(idea);
    const scope: StagingScope = { revise: board, timing };
    const result = await this.gemini.json('Dàn dựng lại theo góp ý', RevisionSchema, [
      { text: storyboardPrompt(script, ctx.library, feedback, ctx.chosen, scope) },
    ], { system: STORYBOARD_SYSTEM, temperature: 0.5 });
    const kept = new Map<number, StoryboardScene>();
    const changed = new Set(result.scenes.map((sc) => sc.sectionIndex));
    board.scenes.forEach((sc, si) => {
      if (!changed.has(si)) kept.set(si, sc);
    });
    const stale = [...changed].filter((i) => i >= 0 && i < script.sections.length).sort((a, b) => a - b);
    const { summary, ...fresh } = result;
    return { board: this.merge(board, fresh, script, kept, stale, ctx), restaged: stale, summary };
  }

  private async context(idea: LessonIdea) {
    const all = await this.assets.list('background');
    const chosenKeys = (idea.backgroundKeys ?? []).filter((k) => all.some((a) => a.key === k));
    const only = chosenKeys.length > 0 && idea.newBackgrounds === false;
    const tag = styleTag(idea);
    // Chỉ gợi ý dùng lại nền đã chọn và nền cùng phong cách với bài (nền phong cách khác phải vẽ mới)
    const library = all.filter((a) => chosenKeys.includes(a.key) || (!only && sameStyle(a, tag)));
    const styles = new Map(all.map((a) => [a.key, a.meta.style ?? null]));
    return { all, library, tag, styles, chosen: { keys: chosenKeys, only } };
  }

  private finish(board: Storyboard, script: LessonScript, ctx: Awaited<ReturnType<StoryboardStep['context']>>) {
    const fixed = restrictBackgrounds(board, {
      chosenKeys: ctx.chosen.keys,
      only: ctx.chosen.only,
      styleTag: ctx.tag,
      styles: ctx.styles,
    });
    return sanitizeStoryboard(fixed, script, ctx.library);
  }

  /** Ghép scene giữ nguyên với scene AI vừa dựng (chỉ lấy scene của section cần dựng lại) */
  private merge(
    board: Storyboard,
    fresh: Storyboard,
    script: LessonScript,
    kept: Map<number, StoryboardScene>,
    stale: number[],
    ctx: Awaited<ReturnType<StoryboardStep['context']>>,
  ): Storyboard {
    // Quy tắc nền đã chọn / phong cách chỉ áp cho phần AI vừa dựng (phần giữ nguyên đã áp từ lần trước)
    const fixed = restrictBackgrounds(fresh, {
      chosenKeys: ctx.chosen.keys,
      only: ctx.chosen.only,
      styleTag: ctx.tag,
      styles: ctx.styles,
    });
    const staleSet = new Set(stale);
    const scenes = script.sections
      .map((_, si) => (staleSet.has(si) ? fixed.scenes.find((sc) => sc.sectionIndex === si) : undefined) ?? kept.get(si) ?? board.scenes[si])
      .filter((sc): sc is StoryboardScene => !!sc)
      .map((sc, si) => ({ ...sc, sectionIndex: si }));
    // Nền cũ giữ nguyên mô tả (đã vẽ, không vẽ lại); nền mới AI vừa đề xuất được thêm vào
    const backgrounds = [...board.backgrounds];
    for (const b of fixed.backgrounds) if (!backgrounds.some((o) => o.key === b.key)) backgrounds.push(b);
    return sanitizeStoryboard({ backgrounds, scenes }, script, ctx.library);
  }
}

/**
 * Áp lựa chọn bối cảnh của người dùng: chỉ dùng nền đã chọn (thay nền AI tự đề xuất bằng nền đã chọn theo thứ tự),
 * và nền trùng key thư viện nhưng khác phong cách của bài được đổi key để vẽ mới (nền cùng phong cách thì dùng lại).
 * `styles`: key → phong cách của mọi nền trong thư viện.
 */
export function restrictBackgrounds(
  board: Storyboard,
  opts: { chosenKeys: string[]; only: boolean; styleTag: string | null; styles: Map<string, string | null> },
): Storyboard {
  const chosen = new Set(opts.chosenKeys);
  if (opts.only) {
    const map = new Map<string, string>();
    let next = 0;
    const scenes = board.scenes.map((sc) => {
      if (chosen.has(sc.backgroundKey)) return sc;
      // Cùng một nền đề xuất (hoặc biến thể của nó) luôn được thay bằng cùng một nền đã chọn
      const root = board.backgrounds.find((b) => b.key === sc.backgroundKey)?.variantOf ?? sc.backgroundKey;
      if (!map.has(root)) map.set(root, chosen.has(root) ? root : opts.chosenKeys[next++ % opts.chosenKeys.length]);
      return { ...sc, backgroundKey: map.get(root)! };
    });
    return { ...board, backgrounds: board.backgrounds.filter((b) => chosen.has(b.key)).map((b) => ({ ...b, variantOf: undefined })), scenes };
  }
  const rename = (k: string) =>
    opts.styles.has(k) && !chosen.has(k) && opts.styles.get(k) !== opts.styleTag ? restyledKey(k, opts.styleTag) : k;
  return {
    ...board,
    backgrounds: board.backgrounds.map((b) => ({ ...b, key: rename(b.key), variantOf: b.variantOf ? rename(b.variantOf) : undefined })),
    scenes: board.scenes.map((sc) => ({ ...sc, backgroundKey: rename(sc.backgroundKey) })),
  };
}

/**
 * Sửa storyboard cho khớp tuyệt đối với kịch bản đã duyệt (đủ scene, đủ shot, nhân vật hợp lệ) và áp các quy tắc
 * dựng phim mà AI hay bỏ qua: shot/phản shot là cắt thẳng, không di camera liên tục, hạn chế cận mặt,
 * nhân vật giữ nguyên chỗ đứng khi cùng địa điểm.
 */
export function sanitizeStoryboard(board: Storyboard, script: LessonScript, library: Asset[]): Storyboard {
  const visual = new Set(script.characters.filter((c) => c.role !== 'narrator').map((c) => c.id));
  const bgs = new Map<string, StoryboardBackground>();
  for (const b of board.backgrounds) bgs.set(b.key, { ...b, objects: [...new Set(b.objects)] });
  const libKeys = new Map(library.map((l) => [l.key, l]));

  // Nền biến thể phải trỏ tới nền có thật (trong storyboard hoặc thư viện), không trỏ vòng
  for (const b of bgs.values()) {
    if (b.variantOf && (b.variantOf === b.key || (!bgs.has(b.variantOf) && !libKeys.has(b.variantOf)))) delete b.variantOf;
    if (b.variantOf && bgs.get(b.variantOf)?.variantOf) delete b.variantOf; // chỉ một tầng biến thể
  }
  const rootOf = (key: string) => bgs.get(key)?.variantOf ?? libKeys.get(key)?.meta.variantOf ?? key;

  const positionOf = new Map<string, Position>(); // chỗ đứng quen thuộc của từng nhân vật
  let closeups = 0;
  const illustrationKeys = new Set<string>();

  const scenes: StoryboardScene[] = script.sections.map((section, si) => {
    const proposed = board.scenes.find((s) => s.sectionIndex === si);
    const backgroundKey = proposed?.backgroundKey ?? board.scenes[0]?.backgroundKey ?? `scene-${si}`;
    if (!bgs.has(backgroundKey)) {
      const lib = libKeys.get(backgroundKey);
      bgs.set(backgroundKey, {
        key: backgroundKey,
        description: lib?.description ?? `${section.setting}, cheerful and bright`,
        objects: Object.keys(lib?.meta.boxes ?? {}),
      });
    }
    const bg = bgs.get(backgroundKey)!;

    // Nhân vật: chỉ nhân vật có hình, không trùng vị trí, người nói phải có mặt, giữ chỗ đứng cũ nếu được
    const chars: StoryboardScene['characters'] = [];
    const used = new Set<Position>();
    const place = (id: string, preferred?: Position) => {
      if (!visual.has(id) || chars.some((c) => c.id === id)) return;
      const wish = positionOf.get(id) ?? preferred;
      const position = wish && !used.has(wish) ? wish : POSITIONS.find((p) => !used.has(p));
      if (!position) return;
      used.add(position);
      chars.push({ id, position });
      positionOf.set(id, position);
    };
    for (const c of proposed?.characters ?? []) place(c.id, c.position);
    for (const l of section.lines) place(l.speaker);
    const present = new Set(chars.map((c) => c.id));

    let moves = 0;
    const prevShots: Shot[] = [];
    const shots: Shot[] = section.lines.map((line, li) => {
      const s = proposed?.shots.find((x) => x.lineIndex === li);
      const shot: Shot = {
        lineIndex: li,
        framing: s?.framing ?? (li === 0 ? 'wide' : 'two-shot'),
        target: s?.target,
        transition: s?.transition ?? 'cut',
        motion: s?.motion ?? 'static',
        action: s?.action ?? 'talk',
        reaction: s?.reaction ?? 'none',
        overlay: s?.overlay,
        sfx: s?.sfx,
        illustrations: sanitizeIllustrations(s ? shotIllustrations(s) : [], line.text, illustrationKeys),
      };
      if (!shot.illustrations?.length) delete shot.illustrations;
      const visible = present.has(line.speaker);
      if (shot.framing === 'object' && !shot.target) shot.framing = visible ? 'medium' : 'wide';
      if (!visible && shot.framing !== 'object') shot.framing = 'wide';
      if (shot.action === 'point' && !shot.target) shot.action = 'talk';
      if (shot.framing === 'close-up' && ++closeups > MAX_CLOSEUPS) shot.framing = 'medium';

      // Shot/phản shot: đổi người nói giữa hai khung chặt thì cắt thẳng
      const prevLine = section.lines[li - 1];
      const prevShot = li > 0 ? prevShots[li - 1] : null;
      if (li === 0) shot.transition = 'cut';
      else if (prevShot && prevLine && prevLine.speaker !== line.speaker && TIGHT.has(prevShot.framing) && TIGHT.has(shot.framing)) {
        shot.transition = 'cut';
      }
      moves = shot.transition === 'move' ? moves + 1 : 0;
      if (moves > 2) {
        shot.transition = 'cut';
        moves = 0;
      }

      for (const target of [shot.target, shot.overlay?.kind === 'label' ? shot.overlay.target : undefined]) {
        if (target && !bg.objects.includes(target)) bg.objects.push(target);
      }
      prevShots[li] = shot;
      return shot;
    });

    return { sectionIndex: si, backgroundKey, transition: proposed?.transition ?? 'iris', characters: chars, shots };
  });

  // Chuyển cảnh: cùng nền → cắt; cùng địa điểm (nền biến thể) → hoà tan; khác nơi → iris/slide
  scenes.forEach((scene, i) => {
    if (i === 0) {
      scene.transition = 'iris';
      return;
    }
    const prev = scenes[i - 1];
    if (prev.backgroundKey === scene.backgroundKey) scene.transition = 'cut';
    else if (rootOf(prev.backgroundKey) === rootOf(scene.backgroundKey)) scene.transition = 'dissolve';
    else if (scene.transition !== 'slide') scene.transition = 'iris';
  });

  const usedKeys = new Set(scenes.map((s) => s.backgroundKey));
  // Nền gốc của biến thể cũng phải được giữ để vẽ trước (nếu chưa có trong thư viện)
  for (const k of [...usedKeys]) {
    const root = bgs.get(k)?.variantOf;
    if (root && bgs.has(root) && !libKeys.has(root)) usedKeys.add(root);
  }
  return {
    v: STORYBOARD_VERSION,
    sections: script.sections.map(sectionPrint),
    backgrounds: [...bgs.values()].filter((b) => usedKeys.has(b.key)),
    scenes,
  };
}

/**
 * Từ chỉ vị trí trong câu thoại, dài trước ngắn sau ("phía trên" trước "trên"). AI hầu như không điền `relation` nên
 * máy chủ tự đọc ra từ câu: "chim sẻ đậu TRÊN cành cây" → chim sẻ on cành cây.
 */
const RELATION_WORDS: [RegExp, Relation][] = [
  [/phía\s+trên|bên\s+trên/u, 'above'],
  [/bên\s+trái/u, 'left-of'],
  [/bên\s+phải/u, 'right-of'],
  [/phía\s+sau|đằng\s+sau|sau\s+lưng/u, 'behind'],
  [/phía\s+trước|đằng\s+trước|trước\s+mặt/u, 'in-front-of'],
  [/bên\s+cạnh|cạnh|kế\s+bên|bên/u, 'next-to'],
  [/gầm|dưới/u, 'under'],
  [/trên|lên/u, 'on'],
  [/trong|vào/u, 'in'],
];

/**
 * Vị trí của vật `a` so với vật `b` đọc từ câu: "<a> đang hót ở TRÊN <b>" hoặc "TRÊN <b> có <a>". Hai vật phải đứng gần
 * nhau trong cùng một vế câu.
 */
export function relationBetween(text: string, a: string, b: string): Relation | null {
  const lower = text.toLowerCase();
  const ia = lower.indexOf(a.toLowerCase());
  const ib = lower.indexOf(b.toLowerCase());
  if (ia < 0 || ib < 0 || ia === ib) return null;
  const near = (gap: string) => gap.length <= 40 && !/[.!?;,]/.test(gap);
  const find = (gap: string, anchor: '' | '$') => {
    for (const [re, rel] of RELATION_WORDS) {
      if (new RegExp(`(^|\\s)(${re.source})${anchor === '$' ? '\\s*$' : '(\\s|$)'}`, 'u').test(gap)) return rel;
    }
    return null;
  };
  if (ib > ia) {
    const gap = lower.slice(ia + a.length, ib);
    return near(gap) ? find(gap, '') : null;
  }
  // Vật mốc đứng trước: từ chỉ vị trí phải nằm ngay trước vật mốc
  if (!near(lower.slice(ib + b.length, ia))) return null;
  return find(lower.slice(Math.max(0, ib - 16), ib), '$');
}

/**
 * Hình minh hoạ của một câu: giới hạn số hình khác nhau cả bài, mỗi vật một lần, cue phải có trong câu (không có thì
 * hiện ngay đầu câu), quan hệ vị trí phải trỏ tới một vật mốc trong cùng shot.
 */
export function sanitizeIllustrations(items: ShotIllustration[], text: string, used: Set<string>): ShotIllustration[] {
  const out: ShotIllustration[] = [];
  for (const ill of items) {
    if (out.length >= MAX_SHOT_ILLUSTRATIONS) break;
    const key = ill.key.toLowerCase();
    if (out.some((o) => o.key === key)) continue;
    if (!used.has(key) && used.size >= MAX_ILLUSTRATIONS) continue;
    used.add(key);
    const cue = text.toLowerCase().includes(ill.cue.toLowerCase()) ? ill.cue : '';
    // Nhân hình chỉ khi chú thích có dạng "<N> <vật>" ("6 bút chì"); hình chữ số ("Số 8") luôn là một hình.
    // AI cho count mà chú thích thiếu số thì thêm số vào chú thích để người xem thấy tổng.
    let caption = ill.caption.trim();
    const numeral = /^(number|digit|numeral)/.test(key) || /^(chữ\s+)?số\s/iu.test(caption);
    const lead = caption.match(/^(10|[1-9])\s+\p{L}/u);
    let count = lead ? Number(lead[1]) : 1;
    if (!lead && ill.count && ill.count > 1 && !numeral) {
      count = Math.min(10, Math.round(ill.count));
      caption = `${count} ${caption.charAt(0).toLowerCase()}${caption.slice(1)}`;
    }
    if (numeral) count = 1;
    out.push({ ...ill, key, cue, caption: caption.slice(0, 24), count });
  }
  // AI không ghi quan hệ: đọc từ câu thoại ("<vật> ... trên <vật mốc>"), vật mốc là vật đứng sau từ chỉ vị trí
  if (out.length > 1 && !out.some((o) => o.relation)) {
    const anchored = new Set<string>();
    for (const o of out) {
      if (!o.cue || anchored.has(o.key)) continue;
      for (const m of out) {
        if (m === o || !m.cue || m.relation) continue;
        const where = relationBetween(text, o.cue, m.cue);
        if (!where) continue;
        o.relation = { to: m.key, where };
        anchored.add(m.key);
        break;
      }
    }
  }
  // Vật mốc phải có trong shot và bản thân không bám vào vật khác (chỉ một tầng). AI hay ghi mốc lệch key một chút
  // ("tree" thay vì "tree-branch") nên khớp theo phần key; chỉ còn đúng một vật mốc thì gắn vào vật đó.
  const anchors = out.filter((o) => !o.relation).map((o) => o.key);
  const anchorOf = (raw: string, self: string) => {
    const to = raw.toLowerCase().trim();
    const others = anchors.filter((k) => k !== self);
    const words = (k: string) => k.split('-');
    return (
      others.find((k) => k === to) ??
      others.find((k) => k.includes(to) || to.includes(k)) ??
      others.find((k) => words(k).some((w) => w.length > 2 && words(to).includes(w))) ??
      (others.length === 1 ? others[0] : undefined)
    );
  };
  return out.map((o) => {
    if (!o.relation) return o;
    const to = anchorOf(o.relation.to, o.key);
    if (!to) {
      const { relation: _drop, ...rest } = o;
      return rest;
    }
    return { ...o, relation: { to, where: o.relation.where } };
  });
}
