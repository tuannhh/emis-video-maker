'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICES, type SfxId } from '@edu/shared';
import { CharacterCreator } from '@/components/CharacterCreator';
import { useSession } from '@/components/Session';
import { api, type AssetView, type MusicView, type SfxView } from '@/lib/api';

const POSE_LABELS: [string, string][] = [
  ['idle', 'Đứng'],
  ['talk', 'Nói'],
  ['explain', 'Giải thích'],
  ['idea', 'Ý tưởng'],
  ['point', 'Chỉ'],
  ['cheer', 'Reo'],
];

export default function LibraryPage() {
  const { isAdmin } = useSession();
  const [assets, setAssets] = useState<AssetView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.listAssets().then(setAssets).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function remove(a: AssetView) {
    const made = a.meta.origin === 'upload' || a.meta.origin === 'ai';
    const msg = made
      ? `Xoá "${a.name}" khỏi thư viện? Nhân vật này được tạo riêng, muốn dùng lại phải tạo lại.`
      : `Xoá "${a.name}" khỏi thư viện? Lần sản xuất sau AI sẽ vẽ lại.`;
    if (!confirm(msg)) return;
    try {
      await api.deleteAsset(a.id);
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const characters = assets?.filter((a) => a.kind === 'character') ?? [];
  const backgrounds = assets?.filter((a) => a.kind === 'background') ?? [];
  const voiceLabel = (id?: string) => VOICES.find((v) => v.id === id)?.tone ?? id;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Thư viện</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            AI tự vẽ khi bài học cần nhân vật hoặc bối cảnh mới, rồi dùng lại cho các bài sau để hình ảnh nhất quán
            (dùng lại không tốn thêm token).
          </p>
        </div>
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card">
        <div className="card-head">
          <h2>Nhân vật ({characters.length})</h2>
          {!creating ? (
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
              ＋ Tạo nhân vật / tải mascot
            </button>
          ) : null}
        </div>
        {creating ? (
          <div className="creator-box">
            <CharacterCreator
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                load();
              }}
            />
          </div>
        ) : null}
        {characters.length === 0 ? (
          <p className="muted">Chưa có nhân vật nào.</p>
        ) : (
          <div className="asset-grid">
            {characters.map((a) => (
              <div key={a.id} className="asset">
                <div className="asset-img">
                  <img src={a.urls.idle ?? a.urls.source ?? a.urls.base} alt={a.name} loading="lazy" />
                </div>
                {a.meta.ready && !a.meta.rig ? (
                  <div className="muted small" style={{ padding: '0 12px' }}>
                    Mới tạo — các dáng tay, khẩu hình, chớp mắt được dựng khi dùng trong bài học lần đầu.
                  </div>
                ) : (a.meta.rig ?? 1) >= 2 ? (
                  <div className="pose-strip">
                    {POSE_LABELS.filter(([k]) => a.urls[k]).map(([k, label]) => (
                      <figure key={k}>
                        <img src={a.urls[k]} alt={label} loading="lazy" />
                        <figcaption>{label}</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <div className="muted small" style={{ padding: '0 12px' }}>
                    Bộ dáng cũ — lần sản xuất sau AI sẽ vẽ thêm các dáng (giữ nguyên thiết kế).
                  </div>
                )}
                <div className="asset-body">
                  <strong>{a.name}</strong>{' '}
                  {a.meta.origin === 'upload' ? <span className="badge badge-info">Mascot tải lên</span> : null}
                  {a.meta.origin === 'ai' ? <span className="badge badge-muted">Tạo ở thư viện</span> : null}
                  {a.meta.style ? <span className="badge badge-muted">Phong cách riêng</span> : null}
                  <div className="muted">
                    <code>{a.key}</code> · giọng {a.meta.voice} ({voiceLabel(a.meta.voice)})
                  </div>
                  <p className="muted" style={{ margin: '6px 0' }} title={a.description}>
                    {a.description.length > 110 ? `${a.description.slice(0, 110)}…` : a.description}
                  </p>
                  {isAdmin ? (
                    <button className="btn btn-danger btn-sm" onClick={() => remove(a)}>
                      {a.meta.origin ? 'Xoá' : 'Xoá để vẽ lại'}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Bối cảnh ({backgrounds.length})</h2>
        </div>
        {backgrounds.length === 0 ? (
          <p className="muted">Chưa có bối cảnh nào.</p>
        ) : (
          <div className="asset-grid wide">
            {backgrounds.map((a) => (
              <div key={a.id} className="asset">
                <div className="asset-img">
                  <img src={a.urls.image} alt={a.name} loading="lazy" />
                </div>
                <div className="asset-body">
                  <strong>
                    <code>{a.key}</code>
                  </strong>
                  <div className="muted">Vật đã định vị: {Object.keys(a.meta.boxes ?? {}).join(', ') || 'chưa có'}</div>
                  {a.meta.variantOf ? (
                    <div className="muted">
                      Biến thể của <code>{a.meta.variantOf}</code>
                    </div>
                  ) : null}
                  <p className="muted" style={{ margin: '6px 0' }} title={a.description}>
                    {a.description.length > 140 ? `${a.description.slice(0, 140)}…` : a.description}
                  </p>
                  {isAdmin ? (
                    <button className="btn btn-danger btn-sm" onClick={() => remove(a)}>
                      Xoá để vẽ lại
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MusicSection />
      <SfxSection />
    </main>
  );
}

function MusicSection() {
  const { isAdmin } = useSession();
  const [music, setMusic] = useState<MusicView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(() => {
    api.listMusic().then(setMusic).catch(() => setMusic([]));
  }, []);
  useEffect(load, [load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Nhạc nền ({music?.length ?? 0})</h2>
        <div className="actions">
          <button className="btn btn-sm" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            {busy === 'upload' ? <span className="spinner" /> : null} Tải nhạc lên
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={!!busy}
            onClick={() => act('gen', () => api.generateMusic({ name: `Nhạc nền ${new Date().toLocaleDateString('vi-VN')}` }))}
          >
            {busy === 'gen' ? <span className="spinner" /> : null} AI sáng tác
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void act('upload', () => api.uploadMusic(f));
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Bản <strong>mặc định</strong> được dùng khi bài học để chế độ nhạc nền "Tự động". Nhạc tải lên cần có bản quyền sử dụng.
      </p>
      {!music?.length ? (
        <p className="muted">Chưa có nhạc. Bài đầu tiên chọn "Tự động" sẽ được AI sáng tác một bản.</p>
      ) : (
        <div className="sound-list">
          {music.map((m) => (
            <div key={m.id} className="sound-row">
              <div>
                <strong>{m.name}</strong>{' '}
                {m.meta.isDefault ? <span className="badge badge-ok">Mặc định</span> : null}
                <div className="muted small">{m.meta.source === 'ai' ? 'AI sáng tác (Lyria)' : 'Tải lên'}</div>
              </div>
              <audio src={m.url} controls preload="none" />
              <div className="actions" hidden={!isAdmin}>
                {!m.meta.isDefault ? (
                  <button className="btn btn-sm" disabled={!!busy} onClick={() => act('def', () => api.setDefaultMusic(m.id))}>
                    Đặt mặc định
                  </button>
                ) : null}
                <button
                  className="btn btn-sm btn-danger"
                  disabled={!!busy}
                  onClick={() => confirm(`Xoá "${m.name}"?`) && act('del', () => api.deleteMusic(m.id))}
                >
                  Xoá
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SfxSection() {
  const { isAdmin } = useSession();
  const [sfx, setSfx] = useState<SfxView[] | null>(null);
  const [busy, setBusy] = useState<SfxId | null>(null);
  const [target, setTarget] = useState<SfxId | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api.listSfx().then(setSfx).catch(() => setSfx([]));
  }, []);

  const act = async (id: SfxId, fn: () => Promise<SfxView[]>) => {
    setBusy(id);
    try {
      setSfx(await fn());
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Hiệu ứng âm thanh</h2>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Hiệu ứng được hệ thống tự tổng hợp nên không vướng bản quyền. AI chọn hiệu ứng cho từng cảnh; bạn có thể thay từng hiệu ứng bằng
        file riêng (cần có quyền sử dụng thương mại).
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && target) void act(target, () => api.uploadSfx(target, f));
          e.target.value = '';
        }}
      />
      <div className="sound-list">
        {(sfx ?? []).map((x) => (
          <div key={x.id} className="sound-row">
            <div>
              <strong>
                <code>{x.id}</code>
              </strong>{' '}
              {x.custom ? <span className="badge badge-info">File riêng</span> : null}
              <div className="muted small">{x.description}</div>
            </div>
            <audio key={x.url} src={x.url} controls preload="none" />
            <div className="actions" hidden={!isAdmin}>
              <button
                className="btn btn-sm"
                disabled={!!busy}
                onClick={() => {
                  setTarget(x.id);
                  fileRef.current?.click();
                }}
              >
                {busy === x.id ? <span className="spinner" /> : null} Thay file
              </button>
              {x.custom ? (
                <button className="btn btn-sm" disabled={!!busy} onClick={() => act(x.id, () => api.resetSfx(x.id))}>
                  Dùng bản gốc
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
