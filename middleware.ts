import { NextResponse, type NextRequest } from 'next/server';

// LAYER 1 OF 2, AND NOT A SECURITY BOUNDARY.
//
// This runs on the Edge runtime and checks only that a `sid` cookie is PRESENT. It does
// not and must not touch the database: the Edge runtime has no Node APIs, so the pool
// driver cannot run here. A forged or expired cookie passes this check unchallenged.
//
// Its only job is UX — bounce signed-out visitors to /login instead of rendering a page
// that would throw. The real authorization check is requireSession() in every route
// handler and protected Server Component (layer 2).

const SESSION_COOKIE_NAME = 'sid';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/products',
  '/sales',
  '/reorder',
  '/purchase-orders',
  '/assistant',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasCookie = request.cookies.has(SESSION_COOKIE_NAME);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !hasCookie) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  if ((pathname === '/login' || pathname === '/register') && hasCookie) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/products/:path*',
    '/sales/:path*',
    '/reorder/:path*',
    '/purchase-orders/:path*',
    '/assistant/:path*',
    '/login',
    '/register',
  ],
};
