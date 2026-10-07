'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      // Chỉ quay lại đường dẫn nội bộ
      const next = params.get('next') ?? '/';
      window.location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="page login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <h1>Đăng nhập</h1>
        <p className="muted small" style={{ margin: '4px 0 18px' }}>
          Tạo video bài giảng hoạt hình tự động bằng AI. Tài khoản do admin cấp.
        </p>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Mật khẩu</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? <span className="spinner" /> : null} Đăng nhập
        </button>
      </form>
    </main>
  );
}
