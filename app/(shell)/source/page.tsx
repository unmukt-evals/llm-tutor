// app/(shell)/source/page.tsx
// The "Add source" review-gate page. Renders the client pipeline component inside
// the persistent shell. force-dynamic: this page drives server-only routes that
// touch the LLM + filesystem; it must never be statically prerendered.
import SourcePipelineClient from '@/components/SourcePipelineClient';

export const dynamic = 'force-dynamic';

export default function SourcePage() {
  return <SourcePipelineClient />;
}
