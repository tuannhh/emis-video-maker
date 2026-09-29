'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Nav() {
  const path = usePathname();
  const isLibrary = path.startsWith('/library');
  return (
    <nav className="nav">
      <Link href="/" className={!isLibrary ? 'active' : ''}>
        Bài học
      </Link>
      <Link href="/library" className={isLibrary ? 'active' : ''}>
        Thư viện
      </Link>
    </nav>
  );
}
