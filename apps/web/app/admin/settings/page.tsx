'use client';

import { useEffect, useState } from 'react';
import type { SystemSettings } from '@edu/shared';
import { AdminOnly } from '@/components/Session';
import { api, formatTime } from '@/lib/api';

export default function SettingsPage() {
  return (
    <AdminOnly>
      <Settings />
    </AdminOnly>
  );
}

function Settings() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings().then(setSettings).catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, []);

  async function run(fn: () => Promise<SystemSettings>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      setSettings(await fn());
      setApiKey('');
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const g = settings?.gemini;
  return (
    <main className="page narrow">
      <div className="page-head">
        <div>
          <h1>Cài đặt hệ thống</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Chỉ admin thấy trang này.
          </p>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Gemini API key</h2>
          {g ? (
            <span className={`badge ${g.configured ? 'badge-ok' : 'badge-err'}`}>{g.configured ? 'Đang dùng' : 'Chưa có key'}</span>
          ) : null}
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Key dùng cho mọi bước AI: viết kịch bản, vẽ nhân vật và bối cảnh, lồng tiếng, sáng tác nhạc, kiểm tra video. Lấy key tại{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>
          . Key được mã hoá trước khi lưu và không bao giờ hiển thị lại đầy đủ.
        </p>
        {g?.configured ? (
          <div className="key-current">
            <code>••••••••••••{g.last4}</code>
            <span className="muted small">
              {g.source === 'env'
                ? 'Lấy từ biến môi trường GEMINI_API_KEY trên máy chủ'
                : `Cập nhật ${g.updatedAt ? formatTime(g.updatedAt) : ''}${g.updatedBy ? ` bởi ${g.updatedBy}` : ''}`}
            </span>
          </div>
        ) : null}
        {msg ? <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.text}</div> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.setGeminiKey(apiKey), 'Đã kiểm tra và lưu key mới. Các việc tạo video tiếp theo sẽ dùng key này.');
          }}
        >
          <label className="field">
            <span>{g?.configured ? 'Thay bằng key mới' : 'Nhập key'}</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="AIza..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <div className="actions">
            <button className="btn btn-primary" disabled={busy || apiKey.trim().length < 20}>
              {busy ? <span className="spinner" /> : null} Kiểm tra và lưu
            </button>
            {g?.source === 'db' ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => confirm('Xoá key đã lưu? Hệ thống sẽ không gọi được Gemini cho tới khi có key mới.') && run(api.clearGeminiKey, 'Đã xoá key.')}
              >
                Xoá key
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </main>
  );
}
