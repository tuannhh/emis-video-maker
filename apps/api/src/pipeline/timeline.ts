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
      width: a.meta.width ?? 600,
      height: a.meta.height ?? 1400,
      headTop: a.meta.headTop ?? 0.01,
      bodyCx: a.meta.bodyCx ?? 0.5,
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
      if (shot.overlay) {
        const inst = readingOrder(instances[shot.overlay.target] ?? []);
        const single = boxes[shot.overlay.target] ?? targetBox;
        if (shot.overlay.kind === 'count' && inst.length) {
          const startFrames = countTimes(line.ttsText, inst.length, audioOffset, audioFrames);
          overlay = { kind: 'count', text: shot.overlay.text, boxes: inst, startFrames };
          startFrames.forEach((f, k) => addSfx('pop', sceneFrom + from + f, 0.7, Math.min(1.6, 1 + k * 0.05)));
          addSfx('ding', sceneFrom + from + startFrames[startFrames.length - 1] + 12, 0.6);
        } else if (single) {
          overlay = { kind: 'label', text: shot.overlay.text, boxes: [single], startFrames: [audioOffset + 4] };
          addSfx('pop', sceneFrom + from + audioOffset + 4, 0.8);
        }
      }
      if (shot.sfx) addSfx(shot.sfx, absAudio, 0.8);
      if (shot.reaction === 'hop' && listener) {
        addSfx('boing', sceneFrom + from + audioOffset + Math.min(20, Math.round(audioFrames * 0.3)) + 4, 0.35);
      }

      return {
        from,
        durationInFrames,
        speaker: line.speaker,
        text: line.text,
        audioSrc: clip ? url(clip.fileKey) : null,
        audioOffset,
        audioFrames,
        mouth: clip?.mouth ?? '',
        level: clip?.level ?? '',
        framing,
        targetBox,
        // Shot đầu mỗi cảnh không có gì để "di chuyển từ"
        transition: i === 0 ? 'cut' : shot.transition,
        motion: shot.motion,
        action,
        reaction: listener ? shot.reaction : 'none',
        listener,
        overlay,
      };
    });

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
        x: POSITION_X[c.position],
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
