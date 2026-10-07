import path from 'node:path';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến môi trường ${name}`);
  return v;
}

function appSecret() {
  const v = process.env.APP_SECRET;
  if (v && v.length >= 32) return v;
  if (process.env.NODE_ENV === 'production') throw new Error('Thiếu biến môi trường APP_SECRET (ít nhất 32 ký tự)');
  return 'dev-only-secret-do-not-use-in-production-0000';
}

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');

export const config = {
  port: Number(process.env.API_PORT ?? 4100),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3100',
  databaseUrl: required('DATABASE_URL'),
  redis: { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) },
  storageDir: path.resolve(process.env.STORAGE_DIR ?? './data/storage'),
  /** Gốc URL trình duyệt dùng để tải file; để trống = cùng origin với web (Next.js proxy /files) */
  filesPublicUrl: (process.env.FILES_PUBLIC_URL ?? '').replace(/\/$/, ''),
  /** URL renderer (Chromium trong worker) dùng để tải file */
  filesInternalUrl: (process.env.FILES_INTERNAL_URL ?? 'http://localhost:4100').replace(/\/$/, ''),
  /** Bí mật ký phiên đăng nhập, link nội bộ và mã hoá API key lưu trong DB */
  appSecret: appSecret(),
  /** Tài khoản admin tạo sẵn lần đầu (không ghi đè nếu email đã tồn tại) */
  admin: { email: (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase(), password: process.env.ADMIN_PASSWORD ?? '' },
  /** Cookie chỉ gửi qua HTTPS (bật khi chạy trên Cloud Run) */
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /**
   * bullmq: hàng đợi Redis + tiến trình worker (chạy local bằng Docker Compose).
   * cloudrun: mỗi việc chạy một lần Cloud Run Job (không cần Redis, không tốn tiền khi rảnh).
   */
  queue: {
    driver: (process.env.QUEUE_DRIVER ?? 'bullmq') as 'bullmq' | 'cloudrun',
    project: process.env.GCP_PROJECT ?? '',
    region: process.env.GCP_REGION ?? '',
    job: process.env.WORKER_JOB ?? '',
  },
  /** Bucket GCS gắn vào STORAGE_DIR (Cloud Run volume): tải file qua link ký sẵn thay vì đi qua API */
  storageBucket: process.env.STORAGE_BUCKET ?? '',
  gemini: {
    /** Dự phòng khi admin chưa nhập key trên trang Cài đặt */
    apiKey: process.env.GEMINI_API_KEY ?? '',
    textModel: process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.8-flash',
    ttsModel: process.env.GEMINI_TTS_MODEL ?? 'gemini-3.8-flash-tts',
    imageModel: process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image',
    musicModel: process.env.GEMINI_MUSIC_MODEL ?? 'lyria-3.5',
  },
  render: {
    concurrency: process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : null,
  },
};
