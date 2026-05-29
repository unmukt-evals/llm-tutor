import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const config = {
  matcher: ['/studio/:path*', '/api/studio/:path*'],
};

export function middleware(req: NextRequest) {
  const expected = process.env.LLMTUTOR_STUDIO_TOKEN;
  if (!expected) return NextResponse.next();
  const auth = req.headers.get('authorization');
  const headerToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const queryToken = req.nextUrl.searchParams.get('token');
  const provided = headerToken ?? queryToken;
  if (provided && provided === expected) return NextResponse.next();
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
