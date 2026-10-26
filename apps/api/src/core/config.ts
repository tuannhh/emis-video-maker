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
  gemini: (() => {
    /**
     * agent-platform: Gemini Enterprise Agent Platform (tên cũ Vertex AI), xác thực bằng service account
     * (file khoá JSON qua GOOGLE_APPLICATION_CREDENTIALS, hoặc service account của Cloud Run).
     * developer-api: Gemini Developer API bằng API key (đường cũ, giữ để rollback).
     */
    const provider = (process.env.GEMINI_PROVIDER ??
      (process.env.GOOGLE_CLOUD_PROJECT ? 'agent-platform' : 'developer-api')) as 'agent-platform' | 'developer-api';
    const imageModel = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-lite-image';
    return {
      provider,
      project: process.env.GOOGLE_CLOUD_PROJECT ?? '',
      location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
      /** Lyria trên Agent Platform chỉ có ở global/us-central1 */
      musicLocation: process.env.GEMINI_MUSIC_LOCATION || 'global',
      credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '',
      /**
       * developer-api: key chính. agent-platform: key phụ cho dịch vụ Agent Platform chưa có (Lyria 3.x, model
       * Agent Platform báo không tồn tại). Admin nhập key trên trang Cài đặt thì key đó được ưu tiên.
       */
      apiKey: process.env.GEMINI_API_KEY ?? '',
      textModel: process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.8-flash',
      ttsModel: process.env.GEMINI_TTS_MODEL ?? 'gemini-3.8-flash-tts',
      /** Nano Banana 2 Lite: rẻ hơn, chỉ vẽ tối đa 1K; dùng cho hình minh hoạ, dáng và mảnh nhép miệng */
      imageModel,
      /**
       * Ảnh vẽ một lần rồi dùng lại từ thư viện (thiết kế nhân vật, bối cảnh): dùng Nano Banana 2 bản thường, vẽ 2K
       * cho chi tiết và đường nét đẹp hơn. Đặt bằng GEMINI_IMAGE_MODEL để mọi ảnh dùng chung một model.
       */
      imageModelHq: process.env.GEMINI_IMAGE_HQ_MODEL || 'gemini-3.1-flash-image',
      /** Lyria 3.x chỉ có trên Developer API: Agent Platform dùng key phụ cho nhạc, không có key thì dùng musicFallback */
      musicModel: process.env.GEMINI_MUSIC_MODEL || 'lyria-3.5',
      /** Agent Platform chỉ có lyria-002 (bản nhạc ~30 giây, video phát lặp) */
      musicFallback: process.env.GEMINI_MUSIC_FALLBACK_MODEL || 'lyria-002',
    };
  })(),
  render: {
    concurrency: process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : null,
  },
};
