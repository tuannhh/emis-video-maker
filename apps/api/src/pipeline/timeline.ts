import {
  INTRO_AUDIO_OFFSET,
  TRANSITION_FRAMES,
  type Asset,
  type AudioSettings,
  type Box,
  type LessonRenderProps,
  type LessonScript,
  type RenderCharacter,
  type RenderScene,
  type RenderSfxCue,
  type RenderShot,
  type SfxId,
  type Storyboard,
  type MotionLevel,
  EXPRESSIONS,
  MOTION_LEVELS,
  shotIllustrations,
} from '@edu/shared';
import type { ProducedAssets } from './assets.step.js';
import { FPS, type ProducedVoices } from './voice.step.js';

const SHOT_LEAD = 6; // frame chờ trước mỗi câu
const MOVE_LEAD = 10; // shot có camera di chuyển: chờ lâu hơn chút để camera tới nơi
const SHOT_GAP = 10; // nghỉ sau mỗi câu
const SCENE_TAIL = 22;
/** Câu đầu mỗi cảnh bắt đầu sau khi chuyển cảnh xong */
const FIRST_SHOT_LEAD = TRANSITION_FRAMES + 8;

/** Vị trí đứng trong ảnh nền và chiều cao người theo vai */
const POSITION_X = { left: 0.25, center: 0.5, right: 0.75 } as const;
const FEET_Y = 0.95;
const BODY_HEIGHT: Record<string, number> = { adult: 0.64, child: 0.5, mascot: 0.42 };

const msToFrames = (ms: number) => Math.ceil((ms / 1000) * FPS);

const NUMBER_WORDS = new Set(['một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười', 'mốt', 'tư', 'lăm']);

export interface SubtitleCue {
  startFrame: number;
  endFrame: number;
  speaker: string;
  text: string;
}

export interface TimelineInput {
  script: LessonScript;
  board: Storyboard;
  assets: ProducedAssets;
  voices: ProducedVoices;
  url: (key: string) => string;
  burnSubtitles: boolean;
  /** Mức chuyển động của nhân vật và hình minh hoạ */
  motion?: MotionLevel;
  audio: AudioSettings;
  sfxKeys: Record<SfxId, string>;
  music: Asset | null;
}

/**
 * Thời điểm đánh số khi đếm: căn theo vị trí các từ chỉ số trong lời đọc ("một, hai, ba...").
 * Không tìm thấy đủ từ chỉ số thì rải đều trên phần có lời.
 */
function countTimes(ttsText: string, n: number, audioOffset: number, audioFrames: number): number[] {
  // Mỗi từ ~ một âm tiết; dấu phẩy/chấm là chỗ ngắt hơi nên cộng thêm thời gian
  const tokens = ttsText.toLowerCase().split(/\s+/).filter(Boolean);
  const words = tokens.map((t) => t.replace(/[^\p{L}]/gu, ''));
  const weights = tokens.map((t, i) => words[i].length + 2 + (/[,;:]$/.test(t) ? 5 : /[.!?…]$/.test(t) ? 8 : 0));
  const idx = words.map((w, i) => (NUMBER_WORDS.has(w) ? i : -1)).filter((i) => i >= 0);
  // Đếm bắt đầu từ "một": lấy n từ chỉ số đầu tiên kể từ đó (câu thường kết bằng "...có mười quả")
  const first = idx.findIndex((i) => words[i] === 'một');
  const from = first >= 0 && idx.length - first >= n ? first : 0;
  const run = idx.slice(from, from + n);
  if (run.length >= n && words.length) {
    const total = weights.reduce((x, y) => x + y, 0);
    const before = (i: number) => weights.slice(0, i).reduce((x, y) => x + y, 0);
    return run.map((i) => audioOffset + Math.round(((before(i) + (words[i].length + 2) * 0.3) / total) * audioFrames));
  }
  const a = audioOffset + audioFrames * 0.15;
  const b = audioOffset + audioFrames * 0.85;
  return Array.from({ length: n }, (_, i) => Math.round(n === 1 ? a : a + ((b - a) * i) / (n - 1)));
}

/**
 * Thứ tự đếm tự nhiên: vật xếp thành hàng tách bạch (khay trứng, hàng ghế) thì đếm từng hàng từ trên xuống,
 * vật chất đống (đĩa cam) thì các "hàng" chồng lên nhau nên đếm lần lượt từ trái sang phải.
 */
function readingOrder(boxes: Box[]): Box[] {
  if (boxes.length < 2) return boxes;
  const cy = (b: Box) => (b[0] + b[2]) / 2;
  const hs = boxes.map((b) => b[2] - b[0]).sort((x, y) => x - y);
  const rowGap = hs[Math.floor(hs.length / 2)] * 0.8;
  const rows: Box[][] = [];
  for (const b of [...boxes].sort((x, y) => cy(x) - cy(y))) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(cy(b) - cy(row[0])) < rowGap) row.push(b);
    else rows.push([b]);
  }
  return rows.flatMap((r) => r.sort((x, y) => x[1] - y[1]));
}

/** Lúc đọc tới cụm từ `cue` trong câu (ước lượng theo vị trí ký tự), hơi sớm một chút để hình kịp bật ra */
function cueTime(text: string, cue: string, audioOffset: number, audioFrames: number): number {
  const at = cue ? text.toLowerCase().indexOf(cue.toLowerCase()) : -1;
  return textTime(text, at, audioOffset, audioFrames);
}

/** Frame (tính từ đầu shot) khi giọng đọc tới ký tự thứ `at` — ước lượng theo tỉ lệ độ dài chữ */
function textTime(text: string, at: number, audioOffset: number, audioFrames: number): number {
  const ratio = at > 0 ? at / Math.max(1, text.length) : 0;
  return Math.max(audioOffset, audioOffset + Math.round(ratio * audioFrames) - 4);
}

const COUNT_WORDS = ['một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười'];

/**
 * Vị trí (ký tự) của từng tiếng đếm "một, hai, ba..." liền nhau trong câu; thiếu tiếng nào thì dừng ở đó.
 * Chỉ nhận tiếng đứng riêng ("ba" không khớp "bao") và các tiếng phải gần nhau (là lời đếm, không phải "một hộp").
 */
function countPositions(text: string, count: number): number[] {
  const t = text.toLowerCase();
  const find = (word: string, from: number) => {
    const re = new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, 'gu');
    re.lastIndex = from;
    const m = re.exec(t);
    return m ? m.index : -1;
  };
  for (let from = 0; ; ) {
    const first = find(COUNT_WORDS[0], from);
    if (first < 0) return [];
    const out = [first];
    for (let i = 1; i < count; i++) {
      const at = find(COUNT_WORDS[i], out[i - 1] + 1);
      if (at < 0 || at - out[i - 1] > 16) break;
      out.push(at);
    }
    if (out.length >= Math.min(count, 2)) return out;
    from = first + 1;
  }
}

const unionBox = (list: Box[]): Box =>
  list.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

/** Số vật cần đếm ghi trong nhãn ("8", "8 bút chì") */
function countOf(text: string): number | null {
  const m = text.match(/\d+/);
  return m ? Number(m[0]) : null;
}

interface Footprint {
  id: string;
  x: number;
  /** Nửa bề ngang thân (tỉ lệ chiều rộng nền) */
  half: number;
  top: number;
}

/**
 * Nhân vật đứng chắn đồ vật đang được đếm/gắn nhãn thì nhãn số nằm đè lên người: dời nhân vật sang bên gần nhất
 * còn trống (không chắn vật, không chồng lên người khác). Toạ độ chuẩn hoá theo ảnh nền.
 */
function clearOfTargets(people: Footprint[], targets: Box[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!targets.length) return out;
  const covers = (x: number, f: Footprint) =>
    targets.some((b) => {
      const ix = Math.min(b[3], x + f.half) - Math.max(b[1], x - f.half);
      const iy = b[2] - Math.max(b[0], f.top);
      return ix > (b[3] - b[1]) * 0.25 && iy > (b[2] - b[0]) * 0.25;
    });
  const placed: { x: number; half: number }[] = [];
  for (const f of [...people].sort((a, b) => a.x - b.x)) {
    const free = (x: number) => !covers(x, f) && placed.every((p) => Math.abs(p.x - x) >= (p.half + f.half) * 0.9);
    let x = f.x;
    if (!free(x)) {
      const candidates: number[] = [];
      for (let d = 0.025; d <= 0.8; d += 0.025) candidates.push(f.x - d, f.x + d);
      x = candidates.find((c) => c - f.half * 0.6 >= 0.02 && c + f.half * 0.6 <= 0.98 && free(c)) ?? f.x;
    }
    placed.push({ x, half: f.half });
    if (x !== f.x) out.set(f.id, x);
  }
  return out;
}

/** Ghép kịch bản + storyboard + tài sản + giọng đọc thành props có thời gian chính xác cho Remotion. */
export function buildRenderProps(input: TimelineInput): { props: LessonRenderProps; cues: SubtitleCue[] } {
  const { script, board, assets, voices, url, audio } = input;
  const characters: Record<string, RenderCharacter> = {};
  for (const [id, a] of Object.entries(assets.characters)) {
    const f = a.files;
    const img = (k: string, fallback: string) => url(f[k] ?? f[fallback] ?? f.idle ?? f.base);
    const rigged = (a.meta.rig ?? 1) >= 2;
    const layered = (a.meta.rig ?? 1) >= 3 && !!f.mouth;
    // Bộ dáng cũ không có explain/idea: dùng dáng nói thay
    const pose = (k: string, fallback: string) =>
      layered
        ? { closed: img(k, fallback), open: img(k, fallback) }
        : { closed: img(k, f[k] ? k : fallback), open: img(f[k] ? `${k}Open` : `${fallback}Open`, 'mouthOpen') };
    characters[id] = {
      id,
      name: script.characters.find((c) => c.id === id)?.name ?? a.name,
      role: a.meta.role ?? 'child',
      poses: {
        idle: pose('idle', 'base'),
        talk: pose('talk', 'idle'),
        explain: pose('explain', 'talk'),
        idea: pose('idea', 'talk'),
        point: pose('point', 'idle'),
        cheer: pose('cheer', 'idle'),
      },
      layered,
      mouth: layered ? url(f.mouth) : null,
      blink: f.blink ? url(f.blink) : null,
      expressions: Object.fromEntries(
        EXPRESSIONS.filter((e) => layered && f[`expr-${e}`]).map((e) => [e, url(f[`expr-${e}`])]),
      ),
      width: a.meta.width ?? 600,
      height: a.meta.height ?? 1400,
      headTop: a.meta.headTop ?? 0.01,
      bodyCx: a.meta.bodyCx ?? 0.5,
      mouthY: a.meta.mouthY ?? null,
      facing: a.meta.facing ?? (rigged ? 'right' : 'front'),
    };
  }
  const nameOf = (id: string) => script.characters.find((c) => c.id === id)?.name ?? id;
  const roleOf = (id: string) => script.characters.find((c) => c.id === id)?.role ?? 'child';
  const cues: SubtitleCue[] = [];
  const sfx: RenderSfxCue[] = [];
  const voiceIntervals: [number, number][] = [];
  const addSfx = (id: SfxId, from: number, volume = 1, playbackRate = 1) => {
    if (!audio.sfx || !input.sfxKeys[id]) return;
    sfx.push({ src: url(input.sfxKeys[id]), from: Math.max(0, Math.round(from)), volume: volume * audio.sfxVolume, playbackRate });
  };

  const introFrames = voices.intro ? msToFrames(voices.intro.durationMs) : 0;
  const introDuration = Math.max(4 * FPS, INTRO_AUDIO_OFFSET + introFrames + 30);
  if (voices.intro) voiceIntervals.push([INTRO_AUDIO_OFFSET, INTRO_AUDIO_OFFSET + introFrames]);
  addSfx('sparkle', 4, 0.6);
  let cursor = introDuration;

  const scenes: RenderScene[] = board.scenes.map((scene, sceneIdx) => {
    const section = script.sections[scene.sectionIndex];
    const bg = assets.backgrounds[scene.backgroundKey];
    const boxes = bg?.meta.boxes ?? {};
    const instances = bg?.meta.instances ?? {};
    const present = scene.characters.filter((c) => characters[c.id]);
    const presentIds = new Set(present.map((c) => c.id));
    const transition = sceneIdx === 0 && scene.transition === 'cut' ? 'iris' : scene.transition;
    const overlap = transition === 'cut' ? 0 : TRANSITION_FRAMES;
    const sceneFrom = cursor - overlap;
    if (transition === 'iris' || transition === 'slide') addSfx('whoosh', sceneFrom, 0.55);
    let local = 0;

    const shots: RenderShot[] = scene.shots.map((shot, i) => {
      const line = section.lines[shot.lineIndex];
      const clip = voices.lines[`${scene.sectionIndex}:${shot.lineIndex}`];
      const audioFrames = clip ? msToFrames(clip.durationMs) : 2 * FPS;
      const audioOffset = i === 0 ? FIRST_SHOT_LEAD : shot.transition === 'move' ? MOVE_LEAD : SHOT_LEAD;
      const isLast = i === scene.shots.length - 1;
      const durationInFrames = audioOffset + audioFrames + SHOT_GAP + (isLast ? SCENE_TAIL : 0);
      const from = local;
      local += durationInFrames;
      const absAudio = sceneFrom + from + audioOffset;

      cues.push({ startFrame: absAudio, endFrame: absAudio + audioFrames, speaker: nameOf(line.speaker), text: line.text });
      voiceIntervals.push([absAudio, absAudio + audioFrames]);

      // Người nghe: người vừa nói trước đó hoặc sắp nói, nếu không thì người còn lại trong cảnh
      const others = present.filter((c) => c.id !== line.speaker).map((c) => c.id);
      const near = [section.lines[shot.lineIndex - 1]?.speaker, section.lines[shot.lineIndex + 1]?.speaker];
      const listener = near.find((id) => id && id !== line.speaker && presentIds.has(id)) ?? others[0] ?? null;

      const speakerVisible = presentIds.has(line.speaker);
      const targetBox: Box | null = shot.target ? (boxes[shot.target] ?? null) : null;
      let framing = shot.framing;
      if (framing === 'object' && !targetBox) framing = speakerVisible ? 'medium' : 'wide';
      if ((framing === 'medium' || framing === 'close-up' || framing === 'two-shot') && !speakerVisible) {
        framing = targetBox ? 'object' : 'wide';
      }
      const action = shot.action === 'point' && !targetBox ? 'talk' : shot.action;

      let overlay: RenderShot['overlay'] = null;
      let shotTarget = targetBox;
      if (shot.overlay) {
        // AI nhận diện có thể thấy nhiều vật hơn số cần đếm (chồng vở nhận thành 18 quyển): chỉ đánh đúng số đã nói
        const want = shot.overlay.kind === 'count' ? countOf(shot.overlay.text) : null;
        const found = readingOrder(instances[shot.overlay.target] ?? []);
        const inst = want && want < found.length ? found.slice(0, want) : found;
        const single = boxes[shot.overlay.target] ?? targetBox;
        if (shot.overlay.kind === 'count' && inst.length) {
          const startFrames = countTimes(line.ttsText, inst.length, audioOffset, audioFrames);
          overlay = { kind: 'count', text: shot.overlay.text, boxes: inst, startFrames };
          // Đang đếm thì phải thấy rõ từng vật: khung người nói chuyển thành khung đồ vật
          if (framing !== 'wide' && framing !== 'object') {
            framing = 'object';
            shotTarget = unionBox(inst);
          }
          startFrames.forEach((f, k) => addSfx('pop', sceneFrom + from + f, 0.7, Math.min(1.6, 1 + k * 0.05)));
          addSfx('ding', sceneFrom + from + startFrames[startFrames.length - 1] + 12, 0.6);
        } else if (single) {
          overlay = { kind: 'label', text: shot.overlay.text, boxes: [single], startFrames: [audioOffset + 4] };
          addSfx('pop', sceneFrom + from + audioOffset + 4, 0.8);
        }
      }
      if (shot.sfx) addSfx(shot.sfx, absAudio, 0.8);
      // Hình minh hoạ: mỗi vật hiện đúng lúc lời thoại nhắc tới; vật bị thiếu (vẽ lỗi) thì bỏ, vật bám vào nó thành vật độc lập
      const specs = shotIllustrations(shot).filter((sp) => assets.illustrations[sp.key]);
      const illustrations: RenderShot['illustrations'] = specs.map((sp) => {
        const ill = assets.illustrations[sp.key];
        const count = sp.count ?? 1;
        let start = cueTime(line.text, sp.cue, audioOffset, audioFrames);
        const countStarts: number[] = [];
        if (count > 1) {
          // Hiện từng vật đúng lúc đọc "một, hai, ba..."; câu không đếm từng tiếng thì hiện nhanh liên tiếp
          const spoken = countPositions(line.text, count).map((at) => textTime(line.text, at, audioOffset, audioFrames));
          if (spoken.length) start = Math.min(start, spoken[0] - 6);
          // Hiện liên tiếp thì phải xong (cả chú thích tổng) trước khi hết shot
          else start = Math.min(start, durationInFrames - 36 - (count - 1) * 4);
          start = Math.max(audioOffset, start);
          for (let i = 0; i < count; i++) {
            const prev = countStarts[i - 1] ?? start;
            countStarts.push(Math.max(spoken[i] ?? prev + 4, i ? prev + 3 : start));
          }
        }
        const to = sp.relation ? specs.findIndex((o) => o.key === sp.relation!.to && !o.relation) : -1;
        return {
          src: url(ill.files.image),
          caption: sp.caption,
          width: ill.meta.width ?? 900,
          height: ill.meta.height ?? 900,
          // Hiện kịp xem trước khi hết shot
          start: Math.min(start, Math.max(audioOffset, durationInFrames - 30)),
          count,
          countStarts,
          relation: to >= 0 && sp.relation ? { to, where: sp.relation.where } : null,
          size: sp.size ?? 'medium',
        };
      });
      illustrations.forEach((it, k) => {
        addSfx('pop', sceneFrom + from + it.start, 0.6, 1.1 + k * 0.06);
        it.countStarts.slice(1).forEach((f, i) => addSfx('pop', sceneFrom + from + f, 0.4, 1 + i * 0.04));
      });
      if (shot.reaction === 'hop' && listener) {
        addSfx('boing', sceneFrom + from + audioOffset + Math.min(20, Math.round(audioFrames * 0.3)) + 4, 0.35);
      }

      return {
        from,
        durationInFrames,
        speaker: line.speaker,
        emotion: line.emotion,
        text: line.text,
        audioSrc: clip ? url(clip.fileKey) : null,
        audioOffset,
        audioFrames,
        mouth: clip?.mouth ?? '',
        level: clip?.level ?? '',
        framing,
        targetBox: shotTarget,
        // Shot đầu mỗi cảnh không có gì để "di chuyển từ"
        transition: i === 0 ? 'cut' : shot.transition,
        motion: shot.motion,
        action,
        reaction: listener ? shot.reaction : 'none',
        listener,
        overlay,
        illustrations,
      };
    });

    // Vị trí đứng; ai chắn đồ vật đang đếm/gắn nhãn trong cảnh thì dời sang bên
    const bgW = bg?.meta.width ?? 1920;
    const bgH = bg?.meta.height ?? 1080;
    const footprints: Footprint[] = present.map((c) => {
      const ch = characters[c.id];
      const bodyHeight = BODY_HEIGHT[roleOf(c.id)] ?? 0.5;
      const spriteW = (bodyHeight / Math.max(0.3, 1 - ch.headTop)) * (ch.width / ch.height) * (bgH / bgW);
      // Phần thân chiếm khoảng 70% bề ngang khung (khung chừa chỗ cho tay giơ lên)
      return { id: c.id, x: POSITION_X[c.position], half: spriteW * 0.35, top: FEET_Y - bodyHeight };
    });
    const keepClear = shots.flatMap((sh) => sh.overlay?.boxes ?? []);
    const moved = clearOfTargets(footprints, keepClear);

    const rendered: RenderScene = {
      from: sceneFrom,
      durationInFrames: local,
      transition,
      background: {
        src: bg ? url(bg.files.image) : '',
        width: bg?.meta.width ?? 1920,
        height: bg?.meta.height ?? 1080,
      },
      characters: present.map((c) => ({
        id: c.id,
        x: moved.get(c.id) ?? POSITION_X[c.position],
        feetY: FEET_Y,
        bodyHeight: BODY_HEIGHT[roleOf(c.id)] ?? 0.5,
      })),
      shots,
    };
    cursor = sceneFrom + local;
    return rendered;
  });

  const outroFrom = cursor - TRANSITION_FRAMES;
  const outroDuration = Math.max(5 * FPS, 3 * FPS + script.recap.length * 25);
  addSfx('chime', outroFrom + 8, 0.7);
  script.recap.forEach((_, i) => addSfx('pop', outroFrom + 18 + i * 22, 0.45));
  const host = voices.introHost && characters[voices.introHost] ? voices.introHost : null;

  const props: LessonRenderProps = {
    fps: FPS,
    width: 1920,
    height: 1080,
    durationInFrames: outroFrom + outroDuration,
    burnSubtitles: input.burnSubtitles,
    motion: MOTION_LEVELS[input.motion ?? 'normal'].k,
    characters,
    intro: {
      durationInFrames: introDuration,
      title: script.title,
      subtitle: `${script.subject} · ${script.grade}`,
      hostId: host,
      audioSrc: voices.intro ? url(voices.intro.fileKey) : null,
      mouth: voices.intro?.mouth ?? '',
      level: voices.intro?.level ?? '',
    },
    scenes,
    outro: { from: outroFrom, durationInFrames: outroDuration, heading: 'Ghi nhớ', points: script.recap, hostId: host },
    music:
      input.music && audio.musicVolume > 0
        ? { src: url(input.music.files.audio), volume: audio.musicVolume, duckLevel: audio.ducking ? audio.duckLevel : 1 }
        : null,
    sfx,
    voiceIntervals,
  };
  return { props, cues };
}

export function toSrt(cues: SubtitleCue[], fps = FPS): string {
  const ts = (frame: number) => {
    const ms = Math.round((frame / fps) * 1000);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const r = ms % 1000;
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
  };
  return cues
    .map((c, i) => `${i + 1}\n${ts(c.startFrame)} --> ${ts(c.endFrame)}\n${c.speaker}: ${c.text}\n`)
    .join('\n');
}
