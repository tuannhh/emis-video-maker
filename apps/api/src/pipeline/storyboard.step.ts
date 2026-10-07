import { Inject, Injectable } from '@nestjs/common';
import {
  STORYBOARD_VERSION,
  StoryboardSchema,
  type Asset,
  type LessonIdea,
  type LessonScript,
  type Shot,
  type Storyboard,
  type StoryboardBackground,
  type StoryboardScene,
} from '@edu/shared';
import { AssetsRepo } from '../core/assets.repo.js';
import { GeminiService } from '../core/gemini.service.js';
import { STORYBOARD_SYSTEM, storyboardPrompt } from './prompts.js';
import { styleTag } from './script.step.js';

const POSITIONS = ['left', 'right', 'center'] as const;
type Position = (typeof POSITIONS)[number];
const MAX_CLOSEUPS = 2;
const TIGHT = new Set(['medium', 'close-up']);

@Injectable()
export class StoryboardStep {
  constructor(
    @Inject(GeminiService) private readonly gemini: GeminiService,
    @Inject(AssetsRepo) private readonly assets: AssetsRepo,
  ) {}

  async run(script: LessonScript, feedback: string | null | undefined, idea: LessonIdea): Promise<Storyboard> {
    const all = await this.assets.list('background');
    const chosenKeys = (idea.backgroundKeys ?? []).filter((k) => all.some((a) => a.key === k));
    const only = chosenKeys.length > 0 && idea.newBackgrounds === false;
    const tag = styleTag(idea);
    // Có ảnh phong cách: chỉ dùng lại nền đã chọn (nền khác trong thư viện vẽ theo phong cách khác)
    const library = tag || only ? all.filter((a) => chosenKeys.includes(a.key)) : all;
    const board = await this.gemini.json('Dàn dựng cảnh', StoryboardSchema, [
      { text: storyboardPrompt(script, library, feedback, { keys: chosenKeys, only }) },
    ], { system: STORYBOARD_SYSTEM, temperature: 0.6 });
    const fixed = restrictBackgrounds(board, { chosenKeys, only, styleTag: tag, allKeys: new Set(all.map((a) => a.key)) });
    return sanitizeStoryboard(fixed, script, library);
  }
}

/**
 * Áp lựa chọn bối cảnh của người dùng: chỉ dùng nền đã chọn (thay nền AI tự đề xuất bằng nền đã chọn theo thứ tự),
 * và khi vẽ theo ảnh phong cách thì nền mới trùng key thư viện được đổi key để vẽ mới thay vì dùng bản khác phong cách.
 */
export function restrictBackgrounds(
  board: Storyboard,
  opts: { chosenKeys: string[]; only: boolean; styleTag: string | null; allKeys: Set<string> },
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
  if (!opts.styleTag) return board;
  const rename = (k: string) => (opts.allKeys.has(k) && !chosen.has(k) ? `${k}-${opts.styleTag}` : k);
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
      };
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
    backgrounds: [...bgs.values()].filter((b) => usedKeys.has(b.key)),
    scenes,
  };
}
