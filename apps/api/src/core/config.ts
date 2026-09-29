import path from 'node:path';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến môi trường ${name}`);
  return v;
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
  gemini: {
    apiKey: required('GEMINI_API_KEY'),
    textModel: process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.8-flash',
    ttsModel: process.env.GEMINI_TTS_MODEL ?? 'gemini-3.8-flash-tts',
    imageModel: process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image',
    musicModel: process.env.GEMINI_MUSIC_MODEL ?? 'lyria-3.5',
  },
  render: {
    concurrency: process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : null,
  },
};
