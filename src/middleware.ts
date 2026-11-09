/**
 * Route protection: pages that need a login redirect to /login?next=... when the session cookie
 * is missing or its signature/expiry is invalid. (Role and ownership checks happen in the pages,
 * server actions and SQL functions — middleware only checks "is there a valid session".)
 */
import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const PROTECTED = [
  '/dashboard',
  '/feed',
  '/issues',
  '/projects',
  '/applications',
  '/notifications',
  '/profile',
  '/activity',
  '/insights',
];

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const needsLogin = PROTECTED.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (!needsLogin) return NextResponse.next();

  const token = req.cookies.get('dm_session')?.value;
  if (token) {
    try {
      const secret = new TextEncoder().encode(
        process.env.AUTH_SECRET ?? 'dev-only-secret-change-me-before-deploying-0123456789',
      );
      await jwtVerify(token, secret);
      return NextResponse.next();
    } catch {
      /* fall through -> login */
    }
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|.*\\.[a-z0-9]+$).*)'],
};
