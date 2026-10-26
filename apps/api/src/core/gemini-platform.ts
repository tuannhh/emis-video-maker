import fs from 'node:fs';
import type { GeminiPlatform } from '@edu/shared';
import { config } from './config.js';

export const AGENT_PLATFORM = config.gemini.provider === 'agent-platform';

/** Endpoint Agent Platform của một model: vùng "global" dùng host chung, vùng khác có host riêng */
export function agentUrl(model: string, verb: string, location = config.gemini.location) {
  const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${config.gemini.project}/locations/${location}/publishers/google/models/${model}:${verb}`;
}

/**
 * Kiểm tra cấu hình Agent Platform lúc khởi động (dừng ngay nếu sai, không chạy với AI hỏng âm thầm) và trả về
 * thông tin nền tảng đang dùng. Không đặt GOOGLE_APPLICATION_CREDENTIALS thì dùng service account của môi trường
 * chạy (Cloud Run). Chỉ đọc project/email trong file khoá, không bao giờ trả private key ra ngoài.
 */
export function geminiPlatform(): GeminiPlatform {
  const { provider, project, location, credentials, imageModel, imageModelHq, musicModel, musicFallback } = config.gemini;
  const models = { imageModel, imageModelHq, musicModel, musicFallback };
  if (!AGENT_PLATFORM) return { provider, project: null, location: null, account: null, ...models };
  if (!project) throw new Error('GEMINI_PROVIDER=agent-platform cần GOOGLE_CLOUD_PROJECT');
  if (!credentials) return { provider, project, location, account: null, ...models };
  let key: { type?: string; project_id?: string; client_email?: string };
  try {
    key = JSON.parse(fs.readFileSync(credentials, 'utf8'));
  } catch (err) {
    throw new Error(`Không đọc được file khoá GOOGLE_APPLICATION_CREDENTIALS: ${(err as Error).message.split('\n')[0]}`);
  }
  if (key.type !== 'service_account') throw new Error('File khoá GOOGLE_APPLICATION_CREDENTIALS không phải service account');
  if (key.project_id !== project) {
    throw new Error(`File khoá thuộc project ${key.project_id}, khác GOOGLE_CLOUD_PROJECT=${project}`);
  }
  return { provider, project, location, account: key.client_email ?? null, ...models };
}
