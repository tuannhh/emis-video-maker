'use client';

import { useEffect, useRef, useState } from 'react';
import type { AudioSettings } from '@edu/shared';
import { api, type LessonView, type MusicView } from '@/lib/api';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Nhạc nền + hiệu ứng âm thanh của một bài học */
export function AudioCard({ lesson, onSaved }: { lesson: LessonView; onSaved: () => void }) {
  const [draft, setDraft] = useState<AudioSettings>(lesson.audio);
  const [music, setMusic] = useState<MusicView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [genName, setGenName] = useState('Nhạc nền vui tươi');
  const [genStyle, setGenStyle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLAudioElement>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(lesson.audio);
  const rendered = !!lesson.output && (lesson.status === 'final_review' || lesson.status === 'approved');
  const producing = lesson.status === 'producing' || lesson.status === 'generating_script';

  useEffect(() => {
    api.listMusic().then(setMusic).catch(() => setMusic([]));
  }, []);
  useEffect(() => {
    if (!dirty) setDraft(lesson.audio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.audio]);

  const selected =
    draft.musicId === null
      ? null
      : draft.musicId === 'auto'
        ? (music.find((m) => m.meta.isDefault) ?? music[0] ?? null)
        : (music.find((m) => m.id === draft.musicId) ?? null);

  // Nghe thử ở đúng mức âm lượng đã chọn
  useEffect(() => {
    if (previewRef.current) previewRef.current.volume = Math.min(1, draft.musicVolume);
  }, [draft.musicVolume, selected?.url]);

  const set = (patch: Partial<AudioSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      await api.updateAudio(lesson.id, draft, rendered);
      setMsg({ tone: 'ok', text: rendered ? 'Đang render lại video với âm thanh mới' : 'Đã lưu, sẽ áp dụng khi sản xuất video' });
      onSaved();
    });

  const onUpload = (file: File | undefined) =>
    file &&
    run('upload', async () => {
      const m = await api.uploadMusic(file);
      setMusic((list) => [...list, m]);
      set({ musicId: m.id });
    });

  const generate = () =>
    run('generate', async () => {
      const m = await api.generateMusic({
        name: genName.trim() || 'Nhạc nền',
        style: genStyle.trim() || undefined,
        subject: lesson.idea.subject,
        lessonId: lesson.id,
      });
      setMusic((list) => [...list, m]);
      set({ musicId: m.id });
      setGenOpen(false);
    });

  return (
    <div className="card">
      <div className="card-head">
        <h2>Âm thanh</h2>
        {dirty ? <span className="badge badge-warn">Chưa lưu</span> : null}
      </div>
      {msg ? <div className={`alert alert-${msg.tone === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div> : null}

      <label className="field">
        <span>Nhạc nền</span>
        <select
          value={draft.musicId ?? 'none'}
          onChange={(e) => set({ musicId: e.target.value === 'none' ? null : e.target.value })}
        >
          <option value="auto">Tự động — bản mặc định trong thư viện{music.length ? '' : ' (AI sẽ sáng tác)'}</option>
          <option value="none">Không có nhạc nền</option>
          {music.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} {m.meta.source === 'ai' ? '· AI' : '· tải lên'}
              {m.meta.isDefault ? ' · mặc định' : ''}
            </option>
          ))}
        </select>
      </label>
      {selected ? <audio ref={previewRef} className="audio-preview" src={selected.url} controls preload="none" /> : null}

      <div className="actions" style={{ margin: '8px 0 14px' }}>
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          {busy === 'upload' ? <span className="spinner" /> : null} Tải nhạc lên
        </button>
        <button className="btn btn-sm" onClick={() => setGenOpen((v) => !v)} disabled={!!busy}>
          AI sáng tác nhạc mới
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            onUpload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {genOpen ? (
        <div className="sub-card">
          <label className="field">
            <span>Tên bản nhạc</span>
            <input value={genName} onChange={(e) => setGenName(e.target.value)} maxLength={80} />
          </label>
          <label className="field">
            <span>Phong cách (không bắt buộc)</span>
            <input
              value={genStyle}
              onChange={(e) => setGenStyle(e.target.value)}
              placeholder="Ví dụ: nhẹ nhàng, piano và sáo, hợp bài Đạo đức"
              maxLength={300}
            />
          </label>
          <button className="btn btn-primary btn-sm" onClick={generate} disabled={!!busy}>
            {busy === 'generate' ? <span className="spinner" /> : null} Sáng tác (khoảng 30 giây)
          </button>
        </div>
      ) : null}

      <label className="field">
        <span>
          Âm lượng nhạc nền: <strong>{pct(draft.musicVolume)}</strong>
        </span>
        <input
          type="range"
          min={0}
          max={0.6}
          step={0.01}
          value={draft.musicVolume}
          disabled={draft.musicId === null}
          onChange={(e) => set({ musicVolume: Number(e.target.value) })}
        />
      </label>
      <label className="check small">
        <input type="checkbox" checked={draft.ducking} onChange={(e) => set({ ducking: e.target.checked })} />
        Tự giảm nhạc khi nhân vật nói (để không át lời thoại)
      </label>
      {draft.ducking ? (
        <label className="field">
          <span>
            Mức nhạc khi có lời: <strong>{pct(draft.duckLevel)}</strong> của âm lượng trên
          </span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={draft.duckLevel}
            onChange={(e) => set({ duckLevel: Number(e.target.value) })}
          />
        </label>
      ) : null}

      <label className="check small">
        <input type="checkbox" checked={draft.sfx} onChange={(e) => set({ sfx: e.target.checked })} />
        Hiệu ứng âm thanh (chuyển cảnh, nhãn hiện ra, đếm, trả lời đúng...)
      </label>
      {draft.sfx ? (
        <label className="field">
          <span>
            Âm lượng hiệu ứng: <strong>{pct(draft.sfxVolume)}</strong>
          </span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={draft.sfxVolume}
            onChange={(e) => set({ sfxVolume: Number(e.target.value) })}
          />
        </label>
      ) : null}

      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <span className="muted small">
          {rendered ? 'Chỉ render lại, không tốn thêm token AI.' : 'Thay đổi hiệu ứng riêng lẻ trong Thư viện.'}
        </span>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || !!busy || producing}>
          {busy === 'save' ? <span className="spinner" /> : null} {rendered ? 'Lưu & render lại' : 'Lưu'}
        </button>
      </div>
    </div>
  );
}
