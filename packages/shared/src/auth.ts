/** admin: quản trị cấu hình hệ thống (API key, báo cáo chi phí, thành viên); member: tạo, sửa, tải video */
export const USER_ROLES = ['admin', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserView {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Cấu hình hệ thống, chỉ admin xem được */
/** Nền tảng gọi Gemini (cấu hình trên máy chủ, không đổi được từ giao diện) */
export interface GeminiPlatform {
  provider: 'agent-platform' | 'developer-api';
  project: string | null;
  location: string | null;
  /** Email service account trong file khoá; null = service account của môi trường chạy */
  account: string | null;
  imageModel: string;
  /** Model vẽ ảnh chất lượng cao (nhân vật, bối cảnh) */
  imageModelHq: string;
  /** Model nhạc nền ưu tiên (gọi bằng API key phụ nếu Agent Platform chưa có) và model dự phòng trên Agent Platform */
  musicModel: string;
  musicFallback: string;
}

export interface SystemSettings {
  platform: GeminiPlatform;
  gemini: {
    configured: boolean;
    /** db = admin nhập trên trang Cài đặt; env = biến môi trường GEMINI_API_KEY */
    source: 'db' | 'env' | null;
    /** 4 ký tự cuối, để admin nhận ra key đang dùng */
    last4: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  };
}
