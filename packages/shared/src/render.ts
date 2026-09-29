/** Dữ liệu đã được worker tính sẵn thời gian, truyền vào composition Remotion. */
import type { Framing, Pose } from './schemas.js';

/** Frame bắt đầu phát lời chào trong intro */
export const INTRO_AUDIO_OFFSET = 20;
/** Số frame hai cảnh chồng lên nhau khi chuyển cảnh */
export const TRANSITION_FRAMES = 16;

export type Box = [number, number, number, number]; // [ymin, xmin, ymax, xmax] chuẩn hóa 0..1 theo ảnh nền

export interface RenderPoseImages {
  closed: string; // URL PNG nền trong suốt, miệng khép
  /** Ảnh miệng mở nguyên người — chỉ bộ dáng cũ; bộ dáng ghép (layered) dùng miếng dán `mouth` */
  open: string;
}

export interface RenderCharacter {
  id: string;
  name: string;
  role: string;
  poses: Record<Pose, RenderPoseImages>;
  /**
   * true: mọi dáng dùng chung một cái đầu (ghép từ ảnh đứng), miệng và mắt nhắm là miếng dán chồng lên
   * → đổi dáng hay nhép miệng không làm đầu/thân xê dịch.
   */
  layered: boolean;
  /** Miếng dán miệng mở (layered) */
  mouth: string | null;
  /** layered: miếng dán mắt nhắm; bộ dáng cũ: ảnh đứng yên mắt nhắm; null nếu không có */
  blink: string | null;
  /** Kích thước khung chung của mọi dáng, pixel */
  width: number;
  height: number;
  /** Tỉ lệ từ mép trên khung tới đỉnh đầu (khung chứa cả dáng giơ tay nên cao hơn người) */
  headTop: number;
  /** Tâm ngang của thân (tỉ lệ theo chiều rộng khung): điểm đặt và trục lật ảnh */
  bodyCx: number;
  /** Hướng nhìn của ảnh gốc */
  facing: 'right' | 'front';
}

export interface RenderShot {
  from: number; // frame, tính từ đầu scene
  durationInFrames: number;
  speaker: string;
  text: string;
  audioSrc: string | null;
  audioOffset: number; // frame bắt đầu phát audio, tính từ đầu shot
  audioFrames: number;
  /** Chuỗi '0'/'1' theo từng frame của audio: miệng mở hay khép */
  mouth: string;
  /** Chuỗi '0'..'9' theo từng frame: độ lớn giọng, dùng cho nhún người khi nói */
  level: string;
  framing: Framing;
  /** Box vật thể (framing object hoặc vật được chỉ vào) */
  targetBox: Box | null;
  transition: 'cut' | 'move';
  motion: 'static' | 'push-in' | 'pull-out' | 'pan';
  action: Exclude<Pose, 'idle'>;
  reaction: 'none' | 'nod' | 'hop';
  /** Người nghe chính (để khung two-shot và hướng nhìn) */
  listener: string | null;
  overlay: { kind: 'label' | 'count'; text: string; boxes: Box[]; startFrames: number[] } | null;
}

export interface RenderSceneCharacter {
  id: string;
  /** Vị trí trong ảnh nền, chuẩn hoá 0..1 */
  x: number;
  feetY: number;
  /** Chiều cao người (đỉnh đầu → chân) theo tỉ lệ chiều cao ảnh nền */
  bodyHeight: number;
}

export interface RenderScene {
  from: number;
  durationInFrames: number;
  transition: 'iris' | 'slide' | 'dissolve' | 'cut';
  background: { src: string; width: number; height: number };
  characters: RenderSceneCharacter[];
  shots: RenderShot[];
}

export interface RenderIntro {
  durationInFrames: number;
  title: string;
  subtitle: string;
  hostId: string | null;
  audioSrc: string | null;
  mouth: string;
  level: string;
}

export interface RenderOutro {
  from: number;
  durationInFrames: number;
  heading: string;
  points: string[];
  hostId: string | null;
}

export interface RenderSfxCue {
  src: string;
  from: number; // frame tuyệt đối
  volume: number;
  playbackRate: number;
}

export interface RenderMusic {
  src: string;
  volume: number;
  /** Mức nhạc khi có lời thoại (tỉ lệ của volume); 1 = không giảm */
  duckLevel: number;
}

export interface LessonRenderProps {
  [key: string]: unknown;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  burnSubtitles: boolean;
  characters: Record<string, RenderCharacter>;
  intro: RenderIntro;
  scenes: RenderScene[];
  outro: RenderOutro;
  music: RenderMusic | null;
  sfx: RenderSfxCue[];
  /** Các khoảng có lời thoại [từ frame, tới frame], dùng để giảm nhạc nền */
  voiceIntervals: [number, number][];
}
