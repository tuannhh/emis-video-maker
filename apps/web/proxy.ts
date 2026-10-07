import { NextResponse, type NextRequest } from 'next/server';

/**
 * Chưa có cookie phiên thì chuyển sang trang đăng nhập. Đây chỉ là bước lọc nhanh: API mới là nơi kiểm tra
 * chữ ký và quyền thật sự (cookie giả vẫn bị API trả 401, giao diện tự quay về /login).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has('emis_session')) return NextResponse.next();
  const url = new URL('/login', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== '/') url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

export const config = {
  // Bỏ qua API, file, tài nguyên tĩnh của Next và chính trang đăng nhập
  matcher: ['/((?!api/|files/|_next/|login|favicon\.ico|.*\.(?:png|jpg|svg|ico|webp)$).*)'],
};
