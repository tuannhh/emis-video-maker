'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DOCX_MIME,
  IMAGE_MIMES,
  MATERIAL_MIMES,
  MAX_IMAGE_BYTES,
  MAX_MATERIALS,
  MAX_MATERIAL_BYTES,
  PDF_MIME,
  type UploadKind,
  type UploadView,
} from '@edu/shared';
import { api } from '@/lib/api';

export function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** Ảnh dán từ clipboard không có tên: đặt tên theo thời điểm dán */
function named(file: File) {
  if (file.name && file.name !== 'image.png') return file.name;
  const ext = file.type.split('/')[1] ?? 'png';
  return `anh-dan-${new Date().toLocaleTimeString('vi-VN').replace(/:/g, '-')}.${ext}`;
}

export function imagesFromClipboard(e: ClipboardEvent | React.ClipboardEvent) {
  return Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
}

const MATERIAL_ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf,.docx';

function fileIcon(mime: string) {
  if (mime === PDF_MIME) return 'PDF';
  if (mime === DOCX_MIME) return 'DOC';
  return 'ẢNH';
}

interface Pending {
  key: string;
  name: string;
  size: number;
  error?: string;
}

/**
 * Tư liệu tham khảo: ảnh, Word (.docx), PDF tối đa 2MB mỗi tệp. Kéo thả, bấm chọn, hoặc Ctrl+V để dán ảnh
 * (trang cha gọi `addFiles` khi dán ở bất kỳ đâu).
 */
export function MaterialsField({
  value,
  onChange,
  addRef,
}: {
  value: UploadView[];
  onChange: (next: UploadView[]) => void;
  /** Trang cha dùng để thêm ảnh dán từ clipboard */
  addRef?: React.MutableRefObject<((files: File[]) => void) | null>;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  latest.current = value;

  async function addFiles(files: File[]) {
    const room = MAX_MATERIALS - latest.current.length - pending.filter((p) => !p.error).length;
    const list = files.slice(0, Math.max(0, room));
    const rejected: Pending[] = files.slice(list.length).map((f) => ({
      key: `${Date.now()}-${f.name}`,
      name: named(f),
      size: f.size,
      error: `Tối đa ${MAX_MATERIALS} tư liệu`,
    }));
    const jobs = list.map((f, i) => ({ f, p: { key: `${Date.now()}-${i}-${f.name}`, name: named(f), size: f.size } as Pending }));
    setPending((cur) => [...cur.filter((p) => !p.error), ...rejected, ...jobs.map((j) => j.p)]);
    for (const { f, p } of jobs) {
      let error: string | undefined;
      if (f.size > MAX_MATERIAL_BYTES) error = `Tệp ${formatSize(f.size)} vượt quá giới hạn 2MB`;
      else if (f.type && !(MATERIAL_MIMES as readonly string[]).includes(f.type)) error = 'Chỉ nhận ảnh, Word (.docx) hoặc PDF';
      if (!error) {
        try {
          const up = await api.uploadFile('material', f, p.name);
          onChange([...latest.current, up]);
          setPending((cur) => cur.filter((x) => x.key !== p.key));
          continue;
        } catch (e) {
          error = (e as Error).message;
        }
      }
      setPending((cur) => cur.map((x) => (x.key === p.key ? { ...x, error } : x)));
    }
  }
  if (addRef) addRef.current = (files) => void addFiles(files);

  return (
    <div>
      <div
        className={`dropzone${drag ? ' drag' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void addFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <strong>Kéo thả, bấm để chọn, hoặc Ctrl+V để dán ảnh</strong>
        <span className="muted small">
          Ảnh (PNG, JPG), Word (.docx), PDF · tối đa 2MB mỗi tệp · {MAX_MATERIALS} tệp
        </span>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept={MATERIAL_ACCEPT}
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>
      {value.length || pending.length ? (
        <ul className="file-list">
          {value.map((u) => (
            <li key={u.id}>
              <span className="file-icon">{fileIcon(u.mime)}</span>
              <a href={u.url} target="_blank" rel="noreferrer" className="file-name">
                {u.name}
              </a>
              <span className="muted small">{formatSize(u.size)}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(value.filter((x) => x.id !== u.id))}>
                Bỏ
              </button>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.key} className={p.error ? 'file-error' : ''}>
              <span className="file-icon">{p.error ? '!' : <span className="spinner" />}</span>
              <span className="file-name">{p.name}</span>
              <span className="small">{p.error ?? 'Đang tải lên...'}</span>
              {p.error ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending((cur) => cur.filter((x) => x.key !== p.key))}>
                  Bỏ
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Một ảnh (ảnh phong cách, ảnh tham chiếu nhân vật, mascot): bấm chọn, kéo thả, hoặc bấm vào ô rồi Ctrl+V.
 */
export function ImageField({
  kind,
  value,
  onChange,
  label,
  hint,
}: {
  kind: UploadKind;
  value: UploadView | null;
  onChange: (next: UploadView | null) => void;
  label: string;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function add(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!(IMAGE_MIMES as readonly string[]).includes(file.type)) return setError('Chỉ nhận ảnh PNG, JPG hoặc WEBP');
    if (file.size > MAX_IMAGE_BYTES) return setError(`Ảnh ${formatSize(file.size)} vượt quá giới hạn 5MB`);
    setBusy(true);
    try {
      onChange(await api.uploadFile(kind, file, named(file)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {value ? (
        <div className="image-field">
          <img src={value.url} alt={label} />
          <div>
            <div className="small">{value.name}</div>
            <div className="actions" style={{ marginTop: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => input.current?.click()}>
                Đổi ảnh
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
                Bỏ
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`dropzone compact${drag ? ' drag' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onPaste={(e) => {
            const img = imagesFromClipboard(e)[0];
            if (!img) return;
            e.preventDefault();
            e.stopPropagation();
            void add(img);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void add(e.dataTransfer.files[0]);
          }}
        >
          {busy ? <span className="spinner" /> : <strong>{label}</strong>}
          <span className="muted small">{hint ?? 'Bấm để chọn, kéo thả, hoặc bấm vào đây rồi Ctrl+V · tối đa 5MB'}</span>
        </div>
      )}
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          void add(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}

/** Ctrl+V ở bất kỳ đâu trên trang (trừ khi đang gõ chữ hoặc ô ảnh riêng đã nhận) */
export function usePasteImages(onImages: (files: File[]) => void) {
  const cb = useRef(onImages);
  cb.current = onImages;
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const files = imagesFromClipboard(e);
      if (!files.length || e.defaultPrevented) return;
      // Đang gõ chữ mà clipboard có chữ (ví dụ chép từ Word): để ô nhập dán chữ như bình thường
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
      if (typing && e.clipboardData?.getData('text/plain')) return;
      e.preventDefault();
      cb.current(files);
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, []);
}
