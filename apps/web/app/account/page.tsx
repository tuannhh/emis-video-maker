'use client';

import { useState } from 'react';
import { useSession } from '@/components/Session';
import { api } from '@/lib/api';

export default function AccountPage() {
  const { user } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) return setMsg({ ok: false, text: 'Hai lần nhập mật khẩu mới không khớp' });
    setBusy(true);
    setMsg(null);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setAgain('');
      setMsg({ ok: true, text: 'Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <div className="page-head">
        <div>
          <h1>Tài khoản</h1>
          {user ? (
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              {user.name} · {user.email}
            </p>
          ) : null}
        </div>
      </div>
      <form className="card" onSubmit={submit}>
        <h2 style={{ marginBottom: 14 }}>Đổi mật khẩu</h2>
        {msg ? <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.text}</div> : null}
        <label className="field">
          <span>Mật khẩu hiện tại</span>
          <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <div className="row">
          <label className="field">
            <span>Mật khẩu mới (tối thiểu 8 ký tự)</span>
            <input type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label className="field">
            <span>Nhập lại mật khẩu mới</span>
            <input type="password" autoComplete="new-password" minLength={8} required value={again} onChange={(e) => setAgain(e.target.value)} />
          </label>
        </div>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spinner" /> : null} Lưu mật khẩu mới
        </button>
      </form>
    </main>
  );
}
