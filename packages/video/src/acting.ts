import { EXPRESSION_OF_EMOTION, type Expression, type Pose, type RenderShot } from '@edu/shared';
import { hashOf } from './geometry';
import type { RigState } from './components/CharacterRig';

export function activeShotIndex(shots: RenderShot[], frame: number) {
  let idx = 0;
  for (let i = 0; i < shots.length; i++) if (frame >= shots[i].from) idx = i;
  return idx;
}

/** Các cụm nói liền (ngắt khi miệng khép ≥ 9 frame), theo frame của audio */
const phraseCache = new Map<string, [number, number][]>();
function phrases(mouth: string): [number, number][] {
  const hit = phraseCache.get(mouth);
  if (hit) return hit;
  const out: [number, number][] = [];
  let start = -1;
  let lastOpen = -1;
  for (let i = 0; i < mouth.length; i++) {
    if (mouth[i] !== '1') continue;
    if (start < 0) start = i;
    else if (i - lastOpen >= 9) {
      out.push([start, lastOpen]);
      start = i;
    }
    lastOpen = i;
  }
  if (start >= 0) out.push([start, lastOpen]);
  phraseCache.set(mouth, out);
  return out;
}

/** Cử chỉ khi nói (tay), không kể chỉ tay / reo mừng là hành động riêng */
const GESTURES: Pose[] = ['talk', 'explain', 'idea'];
/** Giữ một cử chỉ ít nhất chừng này frame, cụm dài hơn thì đổi cử chỉ giữa chừng */
const MIN_HOLD = 26;
const MAX_HOLD = 64;
/** Nghỉ giữa hai cụm lâu hơn chừng này thì buông tay về dáng đứng */
const REST_GAP = 22;

interface Beat {
  from: number;
  to: number;
  pose: Pose;
}

/**
 * Kịch bản cử chỉ của một câu thoại, theo frame audio: như người thật — giơ tay khi bắt đầu nói, đổi cử chỉ
 * ở chỗ ngắt hơi (hoặc giữa cụm dài), giữ tay qua các nhịp nghỉ ngắn, buông tay khi nghỉ lâu hoặc nói xong.
 */
const beatCache = new Map<string, Beat[]>();
function beats(shot: RenderShot): Beat[] {
  const key = `${shot.speaker}|${shot.action}|${shot.text ?? ''}|${shot.mouth}`;
  const hit = beatCache.get(key);
  if (hit) return hit;
  const ph = phrases(shot.mouth);
  const out: Beat[] = [];
  let n = 0;
  let last: Pose = 'idle';
  const next = () => {
    const pool = GESTURES.filter((g) => g !== last);
    const pose = pool[Math.floor(hashOf(`${key}:${n++}`) * pool.length)];
    last = pose;
    return pose;
  };
  const push = (from: number, to: number, pose: Pose) => {
    const prev = out[out.length - 1];
    if (prev && prev.pose === pose && from - prev.to <= REST_GAP) prev.to = to;
    else out.push({ from, to, pose });
  };

  // Hành động do đạo diễn chọn chiếm phần đầu câu
  let cursor = 0;
  if (shot.action === 'cheer') {
    push(-4, 44, 'cheer');
    last = 'cheer';
    cursor = 45;
  } else if (shot.action === 'point') {
    const end = Math.max(60, (ph[0]?.[1] ?? 56) + 4);
    push(-4, end, 'point');
    last = 'point';
    cursor = end + 1;
  }

  for (let i = 0; i < ph.length; i++) {
    let [s, e] = ph[i];
    if (e < cursor) continue;
    s = Math.max(s, cursor);
    const prev = out[out.length - 1];
    // Cụm ngắn ngay sau cụm trước: giữ nguyên tay, không khua liên tục
    if (prev && s - prev.to <= REST_GAP && e - s < MIN_HOLD) {
      prev.to = e + 6;
      continue;
    }
    const start = prev && s - prev.to <= REST_GAP ? prev.to + 1 : s - 4;
    const len = e + 6 - start;
    const parts = Math.max(1, Math.round(len / MAX_HOLD));
    for (let k = 0; k < parts; k++) {
      const from = Math.round(start + (len * k) / parts);
      const to = Math.round(start + (len * (k + 1)) / parts) - 1;
      push(from, to, next());
    }
  }
  beatCache.set(key, out);
  return out;
}

/** Dáng của người nói tại frame `local` của shot */
export function speakerPose(shot: RenderShot, local: number): Pose {
  const a = local - shot.audioOffset;
  for (const b of beats(shot)) if (a >= b.from && a <= b.to) return b.pose;
  return 'idle';
}

function blinkAt(id: string, frame: number) {
  const period = 100;
  const off = Math.floor(hashOf(id) * period);
  const seg = Math.floor((frame + off) / period);
  const at = 10 + Math.floor(hashOf(`${id}:${seg}`) * 70);
  const pos = (frame + off) % period;
  return pos >= at && pos < at + 4;
}

export interface ActingContext {
  id: string;
  shot: RenderShot;
  local: number;
  frame: number;
  /** Người này có đang đứng bên trái điểm cần nhìn không */
  lookX: number | null;
  x: number;
}

const HOP_FRAMES = 22;

function basic(ctx: ActingContext): { pose: Pose; flip: boolean; hop: number } {
  const { shot, local, id } = ctx;
  const flip = ctx.lookX !== null ? ctx.lookX < ctx.x - 4 : false;
  if (shot.speaker === id) return { pose: speakerPose(shot, local), flip, hop: -1 };
  // Người nghe đứng yên; chỉ nhảy lên reo khi đạo diễn chọn phản ứng "hop"
  const start = hopStartFrame(shot);
  if (start !== null && local >= start && local < start + HOP_FRAMES) {
    return { pose: 'cheer', flip, hop: (local - start) / HOP_FRAMES };
  }
  return { pose: 'idle', flip, hop: -1 };
}

export function hopStartFrame(shot: RenderShot) {
  return shot.reaction === 'hop' ? shot.audioOffset + Math.min(20, Math.round(shot.audioFrames * 0.3)) : null;
}

/** Số frame chuyển dáng (hoà hai dáng tay — đầu và thân chung nên chỉ tay chuyển động) */
export const POSE_BLEND = 2;

/** Số frame hiện dần / tắt dần một biểu cảm */
const EXPR_FADE = 5;
const NOD_FRAMES = 26;

/**
 * Biểu cảm (vùng mắt) tại một frame: người nói theo cảm xúc câu thoại (từ ngay trước khi nói tới hết câu),
 * người nghe vui lây khi nhảy lên reo mừng.
 */
function expressionAt(ctx: ActingContext): Expression | null {
  const { shot, local, id } = ctx;
  if (shot.speaker === id) {
    const e = shot.emotion ? EXPRESSION_OF_EMOTION[shot.emotion] : undefined;
    const a = local - shot.audioOffset;
    return e && a >= -8 && a <= shot.audioFrames + 14 ? e : null;
  }
  const hop = hopStartFrame(shot);
  return hop !== null && local >= hop - 6 && local < hop + HOP_FRAMES + 30 ? 'happy' : null;
}

/** Người nghe gật đầu khi đạo diễn chọn phản ứng "nod": giữa câu, hai nhịp gật */
export function nodStartFrame(shot: RenderShot) {
  return shot.reaction === 'nod' ? shot.audioOffset + Math.min(24, Math.round(shot.audioFrames * 0.4)) : null;
}

/** Độ lớn giọng 0..1 quanh frame `a` của audio (làm mượt để thân không giật theo từng âm tiết) */
function levelAt(shot: RenderShot, a: number) {
  let sum = 0;
  let n = 0;
  for (let k = -3; k <= 3; k++) {
    const c = shot.level[a + k];
    if (c === undefined) continue;
    sum += Number(c) / 9;
    n++;
  }
  return n ? sum / n : 0;
}

export function rigState(ctx: ActingContext, prev: (k: number) => ActingContext): RigState {
  const now = basic(ctx);
  let poseAgo = 99;
  let prevPose: Pose = now.pose;
  let turnAgo = 99;
  for (let k = 1; k <= Math.max(POSE_BLEND, 4) + 1; k++) {
    const b = basic(prev(k));
    if (poseAgo === 99 && b.pose !== now.pose) {
      poseAgo = k - 1;
      prevPose = b.pose;
    }
    if (turnAgo === 99 && b.flip !== now.flip) turnAgo = k - 1;
  }
  const speaking = ctx.shot.speaker === ctx.id;
  const a = ctx.local - ctx.shot.audioOffset;
  const mouthOpen = speaking && ctx.shot.mouth[a] === '1';

  // Biểu cảm hiện dần khi bắt đầu, tắt dần khi hết
  let expression = expressionAt(ctx);
  let exprAlpha = 0;
  if (expression) {
    let k = 1;
    while (k <= EXPR_FADE && expressionAt(prev(k)) === expression) k++;
    exprAlpha = k / (EXPR_FADE + 1);
  } else {
    for (let k = 1; k <= EXPR_FADE; k++) {
      const e = expressionAt(prev(k));
      if (e) {
        expression = e;
        exprAlpha = 1 - k / (EXPR_FADE + 1);
        break;
      }
    }
  }
  const nodStart = speaking ? null : nodStartFrame(ctx.shot);
  const nod = nodStart !== null && ctx.local >= nodStart && ctx.local < nodStart + NOD_FRAMES ? (ctx.local - nodStart) / NOD_FRAMES : -1;
  const level = speaking && a >= 0 && a < ctx.shot.audioFrames ? levelAt(ctx.shot, a) : 0;
  return {
    ...now,
    poseAgo,
    prevPose,
    turnAgo,
    mouthOpen,
    blink: blinkAt(ctx.id, ctx.frame),
    expression,
    exprAlpha,
    nod,
    speaking: speaking && a >= -4 && a < ctx.shot.audioFrames + 6,
    level,
    listening: !speaking && ctx.lookX !== null,
  };
}
