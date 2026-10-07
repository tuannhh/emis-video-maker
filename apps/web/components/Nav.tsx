'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from './Session';

export function Nav() {
  const path = usePathname();
  const { user, isAdmin } = useSession();
  if (!user) return null;
  const links: [string, string][] = [
    ['/', 'Bài học'],
    ['/library', 'Thư viện'],
    ...(isAdmin
      ? ([
          ['/admin/members', 'Thành viên'],
          ['/admin/report', 'Báo cáo'],
          ['/admin/settings', 'Cài đặt'],
        ] as [string, string][])
      : []),
  ];
  const active = (href: string) =>
    href === '/' ? !links.some(([h]) => h !== '/' && path.startsWith(h)) && !path.startsWith('/account') : path.startsWith(href);
  return (
    <>
      <nav className="nav">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className={active(href) ? 'active' : ''}>
            {label}
          </Link>
        ))}
      </nav>
      <UserMenu name={user.name} email={user.email} role={user.role} />
    </>
  );
}

function UserMenu({ name, email, role }: { name: string; email: string; role: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function logout() {
    await api.logout().catch(() => undefined);
    window.location.href = '/login';
  }

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-chip" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="avatar">{name.trim().charAt(0).toUpperCase() || '?'}</span>
        <span className="user-name">{name}</span>
      </button>
      {open ? (
        <div className="user-pop">
          <div className="user-pop-head">
            <strong>{name}</strong>
            <span className="muted small">{email}</span>
            <span className={`badge ${role === 'admin' ? 'badge-info' : 'badge-muted'}`} style={{ alignSelf: 'flex-start' }}>
              {role === 'admin' ? 'Admin' : 'Thành viên'}
            </span>
          </div>
          <Link href="/account" onClick={() => setOpen(false)}>
            Đổi mật khẩu
          </Link>
          <button onClick={logout}>Đăng xuất</button>
        </div>
      ) : null}
    </div>
  );
}
