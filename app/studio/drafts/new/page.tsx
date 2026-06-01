// app/studio/drafts/new/page.tsx
// Phase 5c — the existing /source flow, now rendered under the Studio shell.
// Renders <SourcePipelineClient /> exactly as the prior /source page did.
// force-dynamic: this page drives server-only routes that touch the LLM +
// filesystem; it must never be statically prerendered.
import SourcePipelineClient from '@/components/SourcePipelineClient';

export const dynamic = 'force-dynamic';

export default function NewDraftPage() {
  return <SourcePipelineClient />;
}
