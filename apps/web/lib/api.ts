import type {
  Asset,
  AudioSettings,
  Lesson,
  LessonEvent,
  LessonIdea,
  LessonScript,
  LessonStatus,
  SfxId,
  SystemSettings,
  UsageSummary,
  UserRole,
  UserView,
} from '@edu/shared';

export type LessonView = Lesson & {
  path: string;
  urls: { video: string; thumbnail: string; srt: string } | null;
  /** Tổng token (chỉ có trong danh sách) */
  tokens?: number;
};
export type AssetView = Asset & { urls: Record<string, string> };
export type MusicView = Asset & { url: string };
export interface LessonUsage {
  lessonId: string | null;
  title: string | null;
  code: string | null;
  creatorId: string | null;
  creatorName: string | null;
  calls: number;
  totalTokens: number;
  costUsd: number | null;
  lastAt: string;
}
export interface SfxView {
  id: SfxId;
  description: string;
  url: string;
  custom: Asset | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  // Phiên hết hạn / bị thu hồi: về trang đăng nhập, quay lại trang này sau khi đăng nhập
  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  if (!res.ok) {
    let message = `Lỗi ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) message = Array.isArray(body.message) ? body.message.join('\n') : body.message;
    } catch {
      /* không có body JSON */
    }
    throw new Error(message);
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  return res.json() as Promise<T>;
}

const post = (path: string, body?: unknown) =>
  request<void>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });

/** Gửi file âm thanh thẳng trong thân request */
const upload = <T>(path: string, file: File) =>
  request<T>(`${path}${path.includes('?') ? '&' : '?'}name=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ''))}`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': file.type || 'audio/mpeg' },
  });

export type LessonPayload = { lesson: LessonView; events: LessonEvent[] };

export const api = {
  login: (email: string, password: string) =>
    request<UserView>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => post('/api/auth/logout'),
  me: () => request<UserView>('/api/auth/me'),
  changePassword: (current: string, next: string) =>
    request<void>('/api/auth/password', { method: 'PUT', body: JSON.stringify({ current, next }) }),

  listUsers: () => request<UserView[]>('/api/users'),
  createUser: (body: { email: string; name: string; role: UserRole; password: string }) =>
    request<UserView>('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: string, patch: { name?: string; role?: UserRole; active?: boolean; password?: string }) =>
    request<UserView>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteUser: (id: string) => request<void>(`/api/users/${id}`, { method: 'DELETE' }),

  settings: () => request<SystemSettings>('/api/settings'),
  setGeminiKey: (apiKey: string) =>
    request<SystemSettings>('/api/settings/gemini-key', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  clearGeminiKey: () => request<SystemSettings>('/api/settings/gemini-key', { method: 'DELETE' }),
  usageByLesson: () => request<LessonUsage[]>('/api/usage/lessons'),

  listLessons: () => request<LessonView[]>('/api/lessons'),
  getLesson: (id: string) => request<LessonPayload>(`/api/lessons/${id}`),
  getLessonByCode: (code: string) => request<LessonPayload>(`/api/lessons/by-code/${code}`),
  createLesson: (idea: LessonIdea) => request<LessonView>('/api/lessons', { method: 'POST', body: JSON.stringify(idea) }),
  saveScript: (id: string, script: LessonScript) =>
    request<Lesson>(`/api/lessons/${id}/script`, { method: 'PUT', body: JSON.stringify(script) }),
  regenerateScript: (id: string, feedback: string) => post(`/api/lessons/${id}/script/regenerate`, { feedback }),
  approveScript: (id: string) => post(`/api/lessons/${id}/script/approve`),
  approveFinal: (id: string) => post(`/api/lessons/${id}/final/approve`),
  rejectFinal: (id: string, feedback: string, mode: 'script' | 'video') =>
    post(`/api/lessons/${id}/final/reject`, { feedback, mode }),
  retry: (id: string) => post(`/api/lessons/${id}/retry`),
  deleteLesson: (id: string) => request<void>(`/api/lessons/${id}`, { method: 'DELETE' }),
  usage: (id: string) => request<UsageSummary>(`/api/lessons/${id}/usage`),
  totalUsage: () => request<UsageSummary>('/api/usage'),
  updateAudio: (id: string, audio: AudioSettings, rerender: boolean) =>
    request<LessonView>(`/api/lessons/${id}/audio`, { method: 'PUT', body: JSON.stringify({ audio, rerender }) }),

  listAssets: () => request<AssetView[]>('/api/assets'),
  deleteAsset: (id: string) => request<void>(`/api/assets/${id}`, { method: 'DELETE' }),

  listMusic: () => request<MusicView[]>('/api/sounds/music'),
  uploadMusic: (file: File) => upload<MusicView>('/api/sounds/music/upload', file),
  generateMusic: (body: { name: string; style?: string; subject?: string; lessonId?: string }) =>
    request<MusicView>('/api/sounds/music/generate', { method: 'POST', body: JSON.stringify(body) }),
  setDefaultMusic: (id: string) => post(`/api/sounds/music/${id}/default`),
  deleteMusic: (id: string) => request<void>(`/api/sounds/music/${id}`, { method: 'DELETE' }),
  listSfx: () => request<SfxView[]>('/api/sounds/sfx'),
  uploadSfx: (id: SfxId, file: File) => upload<SfxView[]>(`/api/sounds/sfx/${id}/upload`, file),
  resetSfx: (id: SfxId) => request<SfxView[]>(`/api/sounds/sfx/${id}`, { method: 'DELETE' }),
};

export const STATUS_META: Record<LessonStatus, { label: string; tone: 'info' | 'warn' | 'ok' | 'err' | 'muted'; busy?: boolean }> = {
  generating_script: { label: 'AI đang viết kịch bản', tone: 'info', busy: true },
  script_review: { label: 'Chờ duyệt kịch bản', tone: 'warn' },
  producing: { label: 'Đang sản xuất video', tone: 'info', busy: true },
  final_review: { label: 'Chờ duyệt thành phẩm', tone: 'warn' },
  approved: { label: 'Đã duyệt', tone: 'ok' },
  failed: { label: 'Lỗi', tone: 'err' },
};

export function formatTime(iso: string) {
  return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

export function formatTokens(n: number) {
  return n.toLocaleString('vi-VN');
}

export function formatUsd(n: number | null) {
  if (n === null) return '—';
  return `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
}

export function slugFileName(title: string) {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'bai-hoc'
  );
}
