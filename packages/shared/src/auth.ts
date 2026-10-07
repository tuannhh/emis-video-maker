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
export interface SystemSettings {
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
