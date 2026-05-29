// app/studio/sources/new/page.tsx
// Phase 5a Task 6 — New source creation page.
// Plain server component: renders <SourceEditClient> with no initial source
// (create mode). No data loading needed — the form starts empty.

import { SourceEditClient } from '@/components/studio/SourceEditClient';

export default function NewSourcePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New source</h1>
      <SourceEditClient />
    </div>
  );
}
