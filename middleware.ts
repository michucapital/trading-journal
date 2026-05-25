import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Protect all UI pages with HTTP Basic Auth.
// API routes (/api/*) are excluded so NT8 and internal fetches work without browser auth.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth for all API routes
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const user     = process.env.BASIC_AUTH_USER     || 'admin';
  const password = process.env.BASIC_AUTH_PASSWORD || '';

  // If no password configured, skip auth (dev mode)
  if (!password) {
    return NextResponse.next();
  }

  const authHeader = request.headers.get('authorization') ?? '';

  if (authHeader.startsWith('Basic ')) {
    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    const [incomingUser, ...rest] = decoded.split(':');
    const incomingPass = rest.join(':'); // handles passwords that contain colons

    if (incomingUser === user && incomingPass === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Trading Journal", charset="UTF-8"',
    },
  });
}

export const config = {
  // Run on all routes except Next.js internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
