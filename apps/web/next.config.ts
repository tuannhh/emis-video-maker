import path from 'node:path';
import type { NextConfig } from 'next';

// Trình duyệt chỉ gọi web; Next.js chuyển tiếp /api và /files sang backend (không cần CORS)
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4100';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // Cho phép tải file nhạc nền / hiệu ứng lên qua proxy /api
  // proxyTimeout: AI vẽ nhân vật xem trước mất 15–60 giây (mặc định Next.js cắt ở 30 giây)
  experimental: { proxyClientMaxBodySize: '40mb', proxyTimeout: 300_000 },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiUrl}/api/:path*` },
      { source: '/files/:path*', destination: `${apiUrl}/files/:path*` },
    ];
  },
};

export default nextConfig;
