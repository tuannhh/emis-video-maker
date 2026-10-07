import { z } from 'zod';
import { AudioSettingsSchema, SFX_IDS, type AudioSettings } from './catalog.js';

/** Giọng đọc có sẵn của Gemini TTS, kèm mô tả để AI chọn cho nhân vật. */
export const VOICES = [
  { id: 'Leda', gender: 'female', tone: 'trẻ trung, trong trẻo', suits: 'bé gái' },
  { id: 'Zephyr', gender: 'female', tone: 'tươi sáng, hồn nhiên', suits: 'bé gái, linh vật' },
  { id: 'Puck', gender: 'male', tone: 'vui tươi, năng động', suits: 'bé trai' },
  { id: 'Fenrir', gender: 'male', tone: 'hào hứng, sôi nổi', suits: 'bé trai, linh vật' },
  { id: 'Kore', gender: 'female', tone: 'rõ ràng, chắc chắn', suits: 'cô giáo, người dẫn chuyện' },
  { id: 'Aoede', gender: 'female', tone: 'nhẹ nhàng, ấm áp', suits: 'người dẫn chuyện, mẹ' },
  { id: 'Charon', gender: 'male', tone: 'trầm ấm, truyền cảm', suits: 'thầy giáo, bố, ông' },
] as const;
export const VOICE_IDS = VOICES.map((v) => v.id) as [string, ...string[]];

/**
 * Cảm xúc khi đọc. `style` gửi cho Gemini TTS qua trường có cấu trúc `speechMetadata.style`
 * (không nằm trong lời thoại nên model không đọc thành tiếng), luôn kèm chỉ định giọng miền Bắc.
 * Đã đo: không chỉ định thì mỗi request TTS ra giọng Bắc/Nam ngẫu nhiên.
 */
export const EMOTIONS = {
  cheerful: { label: 'Vui vẻ', style: 'cheerful and friendly' },
  excited: { label: 'Hào hứng', style: 'excited and lively' },
  curious: { label: 'Tò mò', style: 'curious, wondering' },
  surprised: { label: 'Ngạc nhiên', style: 'surprised and amazed' },
  explaining: { label: 'Giải thích', style: 'calm, clear and patient, like a kind teacher' },
  warm: { label: 'Ấm áp', style: 'warm and gentle' },
  proud: { label: 'Tự hào', style: 'proud and happy' },
  thoughtful: { label: 'Suy nghĩ', style: 'thoughtful, slightly slower' },
} as const;
export type Emotion = keyof typeof EMOTIONS;
export const EMOTION_IDS = Object.keys(EMOTIONS) as [Emotion, ...Emotion[]];

export const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Chỉ dùng chữ thường không dấu, số và dấu gạch ngang')
  .describe('Mã dạng slug: chữ thường tiếng Anh/không dấu, số, nối bằng dấu gạch ngang, ví dụ "be-nam", "kitchen-home"');

// ---------------------------------------------------------------------------
// Ý tưởng do người dùng nhập
// ---------------------------------------------------------------------------
export const LessonIdeaSchema = z.object({
  topic: z.string().min(3).max(500),
  subject: z.string().min(1).max(100),
  grade: z.string().min(1).max(50),
  durationSec: z.number().int().min(30).max(300),
  notes: z.string().max(2000).optional(),
  burnSubtitles: z.boolean().default(true),
  audio: AudioSettingsSchema.optional(),
});
export type LessonIdea = z.infer<typeof LessonIdeaSchema>;

// ---------------------------------------------------------------------------
// Kịch bản bài học (AI tạo, người duyệt/sửa)
// ---------------------------------------------------------------------------
export const ScriptCharacterSchema = z.object({
  id: slug.describe('Mã nhân vật dạng slug không dấu (ví dụ "be-nam"); dùng lại mã có sẵn trong thư viện nếu phù hợp'),
  name: z.string().describe('Tên hiển thị, ví dụ "Bé Na"'),
  role: z.enum(['child', 'adult', 'mascot', 'narrator']),
  description: z
    .string()
    .describe('Mô tả ngoại hình chi tiết bằng tiếng Anh để vẽ nhân vật (tuổi, tóc, trang phục, màu sắc). Bỏ trống với narrator.'),
  voice: z.enum(VOICE_IDS),
});
export type ScriptCharacter = z.infer<typeof ScriptCharacterSchema>;

export const ScriptLineSchema = z.object({
  speaker: z.string().describe('id của nhân vật nói câu này'),
  text: z.string().min(1).describe('Câu thoại hiển thị trên phụ đề'),
  ttsText: z
    .string()
    .describe('Câu thoại để đọc: viết số, ký hiệu toán học thành chữ tiếng Việt (0 → "không", + → "cộng")'),
  emotion: z.enum(EMOTION_IDS).describe('Cảm xúc khi đọc câu này'),
  visualNote: z.string().describe('Gợi ý hình ảnh cho câu này: đang chỉ vào vật gì, cần phóng to vào đâu'),
});
export type ScriptLine = z.infer<typeof ScriptLineSchema>;

export const ScriptSectionSchema = z.object({
  heading: z.string(),
  setting: z.string().describe('Bối cảnh diễn ra phần này, mô tả ngắn bằng tiếng Việt'),
  lines: z.array(ScriptLineSchema).min(1),
});
export type ScriptSection = z.infer<typeof ScriptSectionSchema>;

export const LessonScriptSchema = z.object({
  title: z.string(),
  subject: z.string(),
  grade: z.string(),
  objectives: z.array(z.string()).min(1),
  summary: z.string(),
  characters: z.array(ScriptCharacterSchema).min(1),
  sections: z.array(ScriptSectionSchema).min(1),
  recap: z.array(z.string()).min(1).describe('2-4 ý ghi nhớ hiển thị ở cuối video'),
});
export type LessonScript = z.infer<typeof LessonScriptSchema>;

// ---------------------------------------------------------------------------
// Storyboard (AI dàn dựng từ kịch bản đã duyệt — không được sửa lời thoại)
// ---------------------------------------------------------------------------
/** Dáng tay: talk/explain/idea là cử chỉ khi nói, point/cheer là hành động do đạo diễn chọn */
export const POSES = ['idle', 'talk', 'explain', 'idea', 'point', 'cheer'] as const;
export type Pose = (typeof POSES)[number];

export const FRAMINGS = ['wide', 'two-shot', 'medium', 'close-up', 'object'] as const;
export type Framing = (typeof FRAMINGS)[number];

export const ShotSchema = z.object({
  lineIndex: z.number().int().min(0),
  framing: z
    .enum(FRAMINGS)
    .describe(
      'Cỡ cảnh: wide = toàn cảnh; two-shot = người nói và người nghe; medium = trung cảnh người nói (từ hông trở lên); ' +
        'close-up = cận mặt người nói (khoảnh khắc cảm xúc); object = cận vào vật thể (bắt buộc target)',
    ),
  target: z
    .string()
    .optional()
    .describe('Tên vật thể trong nền: vật được quay cận (framing object) hoặc vật người nói chỉ vào (action point)'),
  transition: z
    .enum(['cut', 'move'])
    .describe('Cách chuyển từ shot trước: cut = cắt thẳng sang khung mới; move = camera lia/zoom mượt sang khung mới'),
  motion: z.enum(['static', 'push-in', 'pull-out', 'pan']).describe('Chuyển động chậm của camera trong suốt shot'),
  action: z
    .enum(['talk', 'point', 'cheer'])
    .describe('Dáng người nói: talk = vừa nói vừa diễn tả bằng tay, point = chỉ vào target, cheer = reo mừng'),
  reaction: z
    .enum(['none', 'nod', 'hop'])
    .describe('Phản ứng của người nghe: nod = gật đầu đồng ý, hop = nhảy lên vì vui mừng/ngạc nhiên'),
  overlay: z
    .object({
      kind: z
        .enum(['label', 'count'])
        .describe('label = một nhãn gắn lên vật; count = đánh số lần lượt 1, 2, 3... lên từng vật khi nhân vật đếm'),
      text: z.string().max(12).describe('Chữ/số của nhãn, ví dụ "10"; với count là tổng số, ví dụ "10"'),
      target: z.string().describe('Tên vật thể (với count là tên từng vật, ví dụ "orange")'),
    })
    .optional(),
  sfx: z
    .enum(SFX_IDS)
    .optional()
    .describe('Hiệu ứng âm thanh khi bắt đầu câu; chỉ dùng khi thật sự hợp (trả lời đúng → ding, kết luận → tada)'),
});
export type Shot = z.infer<typeof ShotSchema>;

export const StoryboardSceneSchema = z.object({
  sectionIndex: z.number().int().min(0),
  backgroundKey: slug,
  transition: z
    .enum(['iris', 'slide', 'dissolve', 'cut'])
    .describe('Chuyển vào cảnh này: iris/slide khi đổi địa điểm; dissolve khi cùng nơi nhưng đồ vật thay đổi; cut khi cùng nền'),
  characters: z.array(z.object({ id: z.string(), position: z.enum(['left', 'center', 'right']) })),
  shots: z.array(ShotSchema).min(1),
});
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;

export const StoryboardBackgroundSchema = z.object({
  key: slug.describe('Key dạng slug tiếng Anh (ví dụ "kitchen-home"); dùng lại key nền có sẵn nếu phù hợp'),
  description: z.string().describe('Mô tả nền bằng tiếng Anh để vẽ (chỉ cần khi là nền mới)'),
  objects: z.array(z.string()).describe('Tên các vật thể (tiếng Anh, ngắn) sẽ được quay cận, chỉ vào hoặc gắn nhãn'),
  variantOf: z
    .string()
    .optional()
    .describe('Key của nền gốc nếu đây là cùng địa điểm, chỉ khác đồ vật (ví dụ đĩa có thêm 1 quả cam)'),
  change: z.string().optional().describe('Với nền biến thể: mô tả tiếng Anh điều khác so với nền gốc'),
});
export type StoryboardBackground = z.infer<typeof StoryboardBackgroundSchema>;

export const StoryboardSchema = z.object({
  backgrounds: z.array(StoryboardBackgroundSchema).min(1),
  scenes: z.array(StoryboardSceneSchema).min(1),
});
/** `v` do hệ thống gắn sau khi kiểm tra; storyboard kiểu cũ (không có v) sẽ được dàn dựng lại. */
export type Storyboard = z.infer<typeof StoryboardSchema> & { v?: number };
export const STORYBOARD_VERSION = 2;

// ---------------------------------------------------------------------------
// AI tự kiểm tra thành phẩm
// ---------------------------------------------------------------------------
export const QaReportSchema = z.object({
  verdict: z.enum(['pass', 'warn', 'fail']),
  summary: z.string(),
  issues: z.array(
    z.object({
      timeSec: z.number(),
      severity: z.enum(['low', 'medium', 'high']),
      category: z.enum(['content', 'audio', 'visual', 'sync', 'other']),
      description: z.string(),
    }),
  ),
});
export type QaReport = z.infer<typeof QaReportSchema>;

// ---------------------------------------------------------------------------
// Vòng đời bài học
// ---------------------------------------------------------------------------
export const LESSON_STATUSES = [
  'generating_script',
  'script_review',
  'producing',
  'final_review',
  'approved',
  'failed',
] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const PRODUCTION_STEPS = ['storyboard', 'assets', 'voice', 'render', 'qa'] as const;
export type ProductionStep = (typeof PRODUCTION_STEPS)[number];

export const STEP_LABELS: Record<ProductionStep | 'script', string> = {
  script: 'Viết kịch bản',
  storyboard: 'Dàn dựng cảnh',
  assets: 'Vẽ nhân vật & bối cảnh',
  voice: 'Lồng tiếng',
  render: 'Render video',
  qa: 'AI kiểm tra thành phẩm',
};

export interface RenderOutput {
  videoKey: string;
  thumbnailKey: string;
  srtKey: string;
  propsKey?: string;
  durationSec: number;
  renderedAt: string;
}

export interface Lesson {
  id: string;
  /** Mã 6 ký tự ở cuối URL */
  code: string;
  title: string;
  idea: LessonIdea;
  status: LessonStatus;
  step: ProductionStep | 'script' | null;
  progress: number;
  error: string | null;
  script: LessonScript | null;
  storyboard: Storyboard | null;
  output: RenderOutput | null;
  qa: QaReport | null;
  feedback: string | null;
  audio: AudioSettings;
  /** Thành viên tạo bài (null = bài tạo trước khi có tài khoản, hoặc người tạo đã bị xoá) */
  createdBy: string | null;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LessonEvent {
  id: number;
  lessonId: string;
  type: string;
  message: string;
  createdAt: string;
}

export type AssetKind = 'character' | 'background' | 'music' | 'sfx';

export interface Asset {
  id: string;
  kind: AssetKind;
  key: string;
  name: string;
  description: string;
  /**
   * Giá trị là storage key.
   * character: { source, idle, idleOpen, blink, talk, talkOpen, point, pointOpen, cheer, cheerOpen }
   * background: { image }; music/sfx: { audio }
   */
  files: Record<string, string>;
  meta: {
    width?: number;
    height?: number;
    voice?: string;
    role?: string;
    /** character: phiên bản bộ dáng; 2 = 4 dáng × 2 khẩu hình + chớp mắt, nhìn 3/4 sang phải */
    rig?: number;
    /** character: tỉ lệ từ mép trên khung tới đỉnh đầu ở dáng đứng yên (khung chung chứa cả dáng giơ tay) */
    headTop?: number;
    /** character: tâm ngang của thân ở dáng đứng yên, tỉ lệ theo chiều rộng khung */
    bodyCx?: number;
    /** background: box theo định dạng [ymin, xmin, ymax, xmax] chuẩn hóa 0..1 */
    boxes?: Record<string, [number, number, number, number]>;
    /** background: box của từng vật khi đếm (ví dụ từng quả cam) */
    instances?: Record<string, [number, number, number, number][]>;
    variantOf?: string;
    /** background: false = AI kiểm tra vẫn thấy sai sau mọi lần vẽ, lần sản xuất sau sẽ vẽ lại */
    verified?: boolean;
    /** music/sfx */
    durationMs?: number;
    source?: 'upload' | 'ai' | 'builtin';
    prompt?: string;
    mimeType?: string;
    isDefault?: boolean;
  };
  createdAt: string;
}
