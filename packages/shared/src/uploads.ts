/** Tệp người dùng tải lên: tư liệu bài học, ảnh phong cách, ảnh tham chiếu nhân vật, mascot */
export const UPLOAD_KINDS = ['material', 'style', 'reference', 'mascot'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PDF_MIME = 'application/pdf';
export const MATERIAL_MIMES = [...IMAGE_MIMES, PDF_MIME, DOCX_MIME] as const;

/** Tư liệu tối đa 2MB mỗi tệp; ảnh (phong cách, tham chiếu, mascot) tối đa 5MB */
export const MAX_MATERIAL_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface UploadView {
  id: string;
  kind: UploadKind;
  name: string;
  mime: string;
  size: number;
  url: string;
  createdAt: string;
  /** material: số ký tự AI đã đọc được (null = chưa đọc) */
  textLength: number | null;
}

/** Bản xem trước nhân vật AI vẽ ở thư viện (chưa lưu) */
export interface CharacterPreview {
  previewId: string;
  url: string;
  /** Mô tả ngoại hình tiếng Anh dùng để vẽ các dáng và để AI viết kịch bản */
  description: string;
  suggestedName: string;
  suggestedRole: 'child' | 'adult' | 'mascot';
  suggestedVoice: string;
  /** mascot = vẽ lại đúng mascot tải lên (chính diện); design = AI thiết kế nhân vật mới */
  mode: 'mascot' | 'design';
}
