'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UserRole, UserView } from '@edu/shared';
import { AdminOnly, useSession } from '@/components/Session';
import { api, formatTime } from '@/lib/api';

export default function MembersPage() {
  return (
    <AdminOnly>
      <Members />
    </AdminOnly>
  );
}

const ROLE_LABEL: Record<UserRole, string> = { admin: 'Admin', member: 'Thành viên' };

function Members() {
  const { user: me } = useSession();
  const [users, setUsers] = useState<UserView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.listUsers().then(setUsers).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      setError(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function resetPassword(u: UserView) {
    const password = prompt(`Mật khẩu mới cho ${u.name} (tối thiểu 8 ký tự):`);
    if (password) void act(() => api.updateUser(u.id, { password }));
  }

  function rename(u: UserView) {
    const name = prompt('Họ tên:', u.name)?.trim();
    if (name && name !== u.name) void act(() => api.updateUser(u.id, { name }));
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Thành viên</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Thành viên được tạo, sửa và tải video của mọi bài học; chỉ xoá được bài do mình tạo. Thành viên không thấy API
            key, báo cáo chi phí và các trang quản trị.
          </p>
        </div>
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="grid-2">
        <div className="card table-card">
          {!users ? (
            <p className="muted">Đang tải...</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Thành viên</th>
                  <th>Quyền</th>
                  <th>Đăng nhập gần nhất</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id} className={u.active ? '' : 'row-off'}>
                      <td>
                        <strong>{u.name}</strong> {self ? <span className="muted small">(bạn)</span> : null}
                        {!u.active ? (
                          <span className="badge badge-err" style={{ marginLeft: 6 }}>
                            Đã khoá
                          </span>
                        ) : null}
                        <div className="muted small">{u.email}</div>
                      </td>
                      <td>
                        <select
                          value={u.role}
                          disabled={self}
                          onChange={(e) => act(() => api.updateUser(u.id, { role: e.target.value as UserRole }))}
                        >
                          {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="muted small">{u.lastLoginAt ? formatTime(u.lastLoginAt) : 'Chưa đăng nhập'}</td>
                      <td>
                        <div className="actions" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm" onClick={() => rename(u)}>
                            Đổi tên
                          </button>
                          <button className="btn btn-sm" onClick={() => resetPassword(u)}>
                            Đặt lại mật khẩu
                          </button>
                          {!self ? (
                            <button className="btn btn-sm" onClick={() => act(() => api.updateUser(u.id, { active: !u.active }))}>
                              {u.active ? 'Khoá' : 'Mở khoá'}
                            </button>
                          ) : null}
                          {!self ? (
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() =>
                                confirm(`Xoá tài khoản ${u.email}? Bài học người này tạo vẫn được giữ lại.`) &&
                                act(() => api.deleteUser(u.id))
                              }
                            >
                              Xoá
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <aside>
          <CreateMember onCreated={load} />
        </aside>
      </div>
    </main>
  );
}

function CreateMember({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const u = await api.createUser({ name, email, password, role });
      setMsg({ ok: true, text: `Đã tạo tài khoản ${u.email}. Gửi email và mật khẩu cho người dùng để đăng nhập.` });
      setName('');
      setEmail('');
      setPassword('');
      setRole('member');
      onCreated();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2 style={{ marginBottom: 14 }}>Thêm thành viên</h2>
      {msg ? <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.text}</div> : null}
      <label className="field">
        <span>Họ tên</span>
        <input type="text" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Email đăng nhập</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Mật khẩu ban đầu (tối thiểu 8 ký tự)</span>
        <input type="text" required minLength={8} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="field">
        <span>Quyền</span>
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
          <option value="member">Thành viên: tạo, sửa, tải video</option>
          <option value="admin">Admin: thêm cấu hình, API key, báo cáo</option>
        </select>
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? <span className="spinner" /> : null} Tạo tài khoản
      </button>
    </form>
  );
}
