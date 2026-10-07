'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { UserView } from '@edu/shared';
import { api } from '@/lib/api';

interface Session {
  /** undefined = đang tải, null = chưa đăng nhập */
  user: UserView | null | undefined;
  isAdmin: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<Session>({ user: undefined, isAdmin: false, refresh: async () => {} });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [user, setUser] = useState<UserView | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    setUser(await api.me().catch(() => null));
  }, []);
  // Tải lại khi đăng nhập xong chuyển trang
  const onLogin = path.startsWith('/login');
  useEffect(() => {
    if (onLogin) setUser(null);
    else void refresh();
  }, [onLogin, refresh]);
  return (
    <SessionContext.Provider value={{ user, isAdmin: user?.role === 'admin', refresh }}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

/** Bọc trang chỉ dành cho admin */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user, isAdmin } = useSession();
  if (user === undefined) return <main className="page muted">Đang tải...</main>;
  if (!isAdmin) {
    return (
      <main className="page">
        <div className="alert alert-error">Trang này chỉ dành cho admin.</div>
      </main>
    );
  }
  return <>{children}</>;
}
