// app/api/source/fetch/route.ts
// POST { url } → { text }. Server-only; fetches a source URL and extracts text.
import { NextResponse } from 'next/server';
import { fetchUrlText } from '@/lib/source/fetch-url';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const url = (body as { url?: unknown })?.url;
  if (typeof url !== 'string' || url.length === 0) {
    return NextResponse.json({ error: 'Body must be { url: string }' }, { status: 400 });
  }
  try {
    const text = await fetchUrlText(url);
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
