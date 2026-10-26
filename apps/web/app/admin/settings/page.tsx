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
      {settings?.platform.provider === 'agent-platform' ? (
        <div className="card">
          <div className="card-head">
            <h2>Gemini Enterprise Agent Platform</h2>
            <span className="badge badge-ok">Đang dùng</span>
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>
            Các bước AI (viết kịch bản, vẽ hình, lồng tiếng, kiểm tra video) gọi Gemini bằng service account của doanh nghiệp,
            cấu hình trên máy chủ. Dịch vụ nào Agent Platform chưa có (ví dụ nhạc nền {settings.platform.musicModel}) sẽ tự
            chuyển sang Gemini API key phụ bên dưới; không có key phụ thì dùng {settings.platform.musicFallback} trên Agent
            Platform.
          </p>
          <dl className="kv">
            <dt>Project</dt>
            <dd>
              <code>{settings.platform.project}</code>
            </dd>
            <dt>Vùng xử lý</dt>
            <dd>
              <code>{settings.platform.location}</code>
            </dd>
            <dt>Service account</dt>
            <dd>{settings.platform.account ? <code>{settings.platform.account}</code> : 'Service account của máy chủ'}</dd>
            <dt>Model vẽ ảnh</dt>
            <dd>
              <code>{settings.platform.imageModel}</code> (hình minh hoạ) · <code>{settings.platform.imageModelHq}</code> (nhân vật,
              bối cảnh)
            </dd>
            <dt>Nhạc nền</dt>
            <dd>
              <code>{settings.platform.musicModel}</code>{' '}
              {g?.configured ? '(qua API key phụ)' : `(chưa có key phụ, đang dùng ${settings.platform.musicFallback})`}
            </dd>
          </dl>
        </div>
      ) : null}
      <div className="card">
        <div className="card-head">
          <h2>{settings?.platform.provider === 'agent-platform' ? 'Gemini API key phụ' : 'Gemini API key'}</h2>
          {g ? (
            <span className={`badge ${g.configured ? 'badge-ok' : 'badge-err'}`}>{g.configured ? 'Đang dùng' : 'Chưa có key'}</span>
          ) : null}
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          {settings?.platform.provider === 'agent-platform'
            ? 'Không bắt buộc. Chỉ dùng cho dịch vụ Agent Platform chưa có (nhạc nền Lyria mới nhất) hoặc khi một model chưa mở trên Agent Platform. '
            : 'Key dùng cho mọi bước AI: viết kịch bản, vẽ nhân vật và bối cảnh, lồng tiếng, sáng tác nhạc, kiểm tra video. '}
          Lấy key tại{' '}
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
                onClick={() =>
                  confirm(
                    settings?.platform.provider === 'agent-platform'
                      ? 'Xoá key phụ? Nhạc nền sẽ chuyển sang model dự phòng trên Agent Platform.'
                      : 'Xoá key đã lưu? Hệ thống sẽ không gọi được Gemini cho tới khi có key mới.',
                  ) && run(api.clearGeminiKey, 'Đã xoá key.')
                }
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
