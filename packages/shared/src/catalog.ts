import { z } from 'zod';

/** Bỏ dấu tiếng Việt, đưa về dạng slug dùng cho URL: "Làm quen với số 10" → "lam-quen-voi-so-10". */
export function slugify(text: string, fallback = 'bai-hoc'): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return s || fallback;
}

// ---------------------------------------------------------------------------
// Môn học và lớp (chương trình GDPT 2018)
// ---------------------------------------------------------------------------
export const SUBJECTS = [
  'Toán',
  'Tiếng Việt',
  'Tự nhiên và Xã hội',
  'Đạo đức',
  'Khoa học',
  'Lịch sử và Địa lí',
  'Tiếng Anh',
  'Tin học',
  'Công nghệ',
  'Âm nhạc',
  'Mĩ thuật',
  'Giáo dục thể chất',
  'Hoạt động trải nghiệm',
  'Kỹ năng sống',
] as const;

export const GRADES = [
  'Mầm non',
  'Lớp 1',
  'Lớp 2',
  'Lớp 3',
  'Lớp 4',
  'Lớp 5',
  'Lớp 6',
  'Lớp 7',
  'Lớp 8',
  'Lớp 9',
  'Lớp 10',
  'Lớp 11',
  'Lớp 12',
] as const;

/** Mã ngẫu nhiên 6 ký tự ở cuối URL bài học */
export const LESSON_CODE = /^[a-z0-9]{6}$/;

/** URL bài học: /{môn}/{lớp}/{tên-bài}/{mã}, ví dụ /toan/lop-1/lam-quen-voi-so-10/1122ab */
export function lessonPath(l: { code: string; title: string; idea: { subject: string; grade: string } }) {
  return `/${slugify(l.idea.subject, 'mon-hoc')}/${slugify(l.idea.grade, 'lop')}/${slugify(l.title)}/${l.code}`;
}

// ---------------------------------------------------------------------------
// Hiệu ứng âm thanh: tự tổng hợp bằng code (không phụ thuộc bản quyền bên ngoài),
// người dùng có thể thay từng hiệu ứng bằng file của mình trong Thư viện.
// ---------------------------------------------------------------------------
export const SFX = {
  pop: 'Bụp — nhãn/số hiện ra',
  ding: 'Ting — trả lời đúng, điểm nhấn',
  chime: 'Chuông ba nốt — khen ngợi, hoàn thành',
  sparkle: 'Lấp lánh — điều kỳ diệu, phát hiện mới',
  whoosh: 'Vút — chuyển cảnh',
  swish: 'Vụt ngắn — camera lướt nhanh',
  boing: 'Boing — nhảy lên, hài hước',
  click: 'Tách — chạm, chọn',
  tada: 'Ta-da — chúc mừng, kết luận',
  bubble: 'Bong bóng — thắc mắc, suy nghĩ',
} as const;
export type SfxId = keyof typeof SFX;
export const SFX_IDS = Object.keys(SFX) as [SfxId, ...SfxId[]];

// ---------------------------------------------------------------------------
// Âm thanh của bài: nhạc nền + hiệu ứng
// ---------------------------------------------------------------------------
export const AudioSettingsSchema = z.object({
  /** 'auto': dùng bản nhạc mặc định trong thư viện (chưa có thì AI sáng tác); null: không có nhạc */
  musicId: z.union([z.literal('auto'), z.string().uuid(), z.null()]).default('auto'),
  /** Âm lượng nhạc nền khi không có lời thoại, 0..1 */
  musicVolume: z.number().min(0).max(1).default(0.22),
  /** Tự giảm nhạc khi nhân vật nói */
  ducking: z.boolean().default(true),
  /** Mức nhạc khi có lời thoại, tính theo tỉ lệ của musicVolume */
  duckLevel: z.number().min(0).max(1).default(0.35),
  sfx: z.boolean().default(true),
  sfxVolume: z.number().min(0).max(1).default(0.55),
});
export type AudioSettings = z.infer<typeof AudioSettingsSchema>;
export const DEFAULT_AUDIO: AudioSettings = AudioSettingsSchema.parse({});

// ---------------------------------------------------------------------------
// Token Gemini đã dùng
// ---------------------------------------------------------------------------
export interface UsageRow {
  model: string;
  step: string;
  calls: number;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  cachedTokens: number;
  totalTokens: number;
  /** Token theo loại dữ liệu, ví dụ { TEXT: 1200, AUDIO: 300 } */
  input: Record<string, number>;
  output: Record<string, number>;
  costUsd: number | null;
}

export interface UsageSummary {
  totalTokens: number;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  calls: number;
  costUsd: number | null;
  /** Chưa khai báo giá cho model nào đó thì chi phí chỉ là một phần */
  pricingComplete: boolean;
  byModel: UsageRow[];
  byStep: { step: string; calls: number; totalTokens: number; costUsd: number | null }[];
}

export const USAGE_STEP_LABELS: Record<string, string> = {
  script: 'Viết kịch bản',
  storyboard: 'Dàn dựng cảnh',
  assets: 'Vẽ nhân vật & bối cảnh',
  voice: 'Lồng tiếng',
  music: 'Nhạc nền',
  render: 'Render',
  qa: 'AI kiểm tra',
  other: 'Khác',
};
