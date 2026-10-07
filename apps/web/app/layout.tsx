import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { SessionProvider } from '@/components/Session';
import './globals.css';

export const metadata: Metadata = {
  title: 'EMIS Video Maker',
  description: 'Tạo video bài học hoạt hình tự động bằng AI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SessionProvider>
          <header className="topbar">
            <div className="topbar-inner">
              <a href="/" className="brand">
                <span className="brand-mark">▶</span> EMIS Video Maker
              </a>
              <Nav />
            </div>
          </header>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
