'use client';

import { useEffect, useState } from 'react';
import { VOICES, type Asset, type CharacterPreview, type UploadView } from '@edu/shared';
import { api } from '@/lib/api';
import { ImageField } from './Uploads';

type Mode = 'mascot' | 'design';
const ROLE_LABELS: Record<string, string> = { child: 'Học sinh / trẻ em', adult: 'Người lớn (thầy cô, bố mẹ)', mascot: 'Linh vật / mascot' };

/**
 * Thêm nhân vật vào thư viện:
 * - mascot: tải ảnh mascot có sẵn, AI vẽ lại đúng thiết kế trên nền tách được (giữ nguyên hình dáng, màu, logo)
 * - design: AI vẽ nhân vật mới từ yêu cầu (+ ảnh tham chiếu, ảnh phong cách), có nút AI gợi ý yêu cầu
 */
export function CharacterCreator({
  context,
  styleId,
  initialMode = 'design',
  onCreated,
  onCancel,
}: {
  context?: { topic?: string; subject?: string; grade?: string };
  /** Ảnh phong cách của bài đang tạo (nếu có) */
  styleId?: string;
  initialMode?: Mode;
  onCreated: (asset: Asset, mode: Mode) => void;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [mascotImg, setMascotImg] = useState<UploadView | null>(null);
  const [reference, setReference] = useState<UploadView | null>(null);
  const [prompt, setPrompt] = useState('');
  const [useStyle, setUseStyle] = useState(true);
  const [preview, setPreview] = useState<CharacterPreview | null>(null);
  const [name, setName] = useState('');
  const [voice, setVoice] = useState('Zephyr');
  const [role, setRole] = useState('mascot');
  const [busy, setBusy] = useState<null | 'suggest' | 'preview' | 'save'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!preview) return;
    setName(preview.suggestedName);
    setVoice(preview.suggestedVoice);
    setRole(preview.suggestedRole);
  }, [preview]);

  async function run<T>(kind: 'suggest' | 'preview' | 'save', fn: () => Promise<T>) {
    setBusy(kind);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const suggest = () =>
    run('suggest', async () => {
      const r = await api.suggestCharacter({ referenceId: reference?.id, draft: prompt.trim() || undefined, ...context });
      setPrompt(r.prompt);
    });

  const draw = () =>
    run('preview', async () => {
      setPreview(
        await api.previewCharacter(
          mode === 'mascot'
            ? { mode, uploadId: mascotImg!.id }
            : { mode, prompt: prompt.trim(), referenceId: reference?.id, styleId: styleId && useStyle ? styleId : undefined },
        ),
      );
    });

  const save = () =>
    run('save', async () => {
      const asset = await api.createCharacter({ previewId: preview!.previewId, name: name.trim(), voice, role });
      onCreated(asset, mode);
    });

  const canDraw = mode === 'mascot' ? !!mascotImg : !!prompt.trim() || !!reference;

  return (
    <div className="creator">
      <div className="tabs">
        {(['mascot', 'design'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? 'active' : ''}
            onClick={() => {
              setMode(m);
              setPreview(null);
              setError(null);
            }}
          >
            {m === 'mascot' ? 'Tải mascot có sẵn' : 'AI tạo nhân vật mới'}
          </button>
        ))}
      </div>

      {mode === 'mascot' ? (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            Dùng mascot của đơn vị làm nhân vật dẫn dắt video. AI vẽ lại đúng thiết kế (hình dáng, màu sắc, logo) ở tư thế đứng chính diện
            để tách nền và dựng các cử chỉ. Nên dùng ảnh rõ nét, thấy toàn thân, mascot không có màu hồng tím (màu dùng để tách nền).
          </p>
          <ImageField kind="mascot" value={mascotImg} onChange={setMascotImg} label="Ảnh mascot" />
        </>
      ) : (
        <>
          <div className="row">
            <div>
              <div className="field-label">Ảnh tham chiếu nhân vật (không bắt buộc)</div>
              <ImageField
                kind="reference"
                value={reference}
                onChange={setReference}
                label="Ảnh tham chiếu"
                hint="AI lấy ngoại hình từ ảnh này rồi áp dụng yêu cầu bên dưới"
              />
            </div>
          </div>
          <label className="field" style={{ marginTop: 12 }}>
            <span className="field-label-row">
              Yêu cầu tạo nhân vật
              <button type="button" className="btn btn-ghost btn-sm" onClick={suggest} disabled={!!busy}>
                {busy === 'suggest' ? <span className="spinner" /> : '✨'} AI gợi ý
              </button>
            </span>
            <textarea
              rows={4}
              maxLength={1500}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ví dụ: Cô bé lớp 1 tóc buộc hai bên, mặc áo đồng phục trắng, váy xanh navy, đeo balo vàng, rất hiếu động"
            />
          </label>
          {styleId ? (
            <label className="actions small" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={useStyle} onChange={(e) => setUseStyle(e.target.checked)} />
              Vẽ theo ảnh phong cách của bài học này
            </label>
          ) : null}
        </>
      )}

      {error ? <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div> : null}

      <div className="actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-primary" onClick={draw} disabled={!canDraw || !!busy}>
          {busy === 'preview' ? <span className="spinner" /> : null}
          {busy === 'preview' ? ' AI đang vẽ (15–40 giây)...' : preview ? 'Vẽ lại' : mode === 'mascot' ? 'Chuẩn bị mascot' : 'Vẽ nhân vật'}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy === 'save'}>
            Đóng
          </button>
        ) : null}
        <span className="muted small">Mỗi lần vẽ khoảng 1 ảnh (~$0.1). Các dáng tay được dựng khi dùng nhân vật lần đầu.</span>
      </div>

      {preview ? (
        <div className="creator-preview">
          <div className="asset-img">
            <img src={preview.url} alt="Bản xem trước" />
          </div>
          <div>
            <label className="field">
              <span>Tên nhân vật</span>
              <input type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="row">
              <label className="field">
                <span>Giọng đọc</span>
                <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id} — {v.tone}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Vai</span>
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  {Object.entries(ROLE_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted small" style={{ marginTop: 0 }} title={preview.description}>
              Mô tả AI dùng để vẽ các dáng: {preview.description}
            </p>
            <button type="button" className="btn btn-success" onClick={save} disabled={!name.trim() || !!busy}>
              {busy === 'save' ? <span className="spinner" /> : null} Lưu vào thư viện
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
