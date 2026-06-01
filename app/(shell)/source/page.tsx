// app/(shell)/source/page.tsx
// Phase 5c — the draft pipeline has moved into Studio at /studio/drafts/new.
// This route is kept as a permanent (308) redirect so any old bookmark, link,
// or external reference lands on the new location.

import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function SourcePage(): never {
  permanentRedirect('/studio/drafts/new');
}
