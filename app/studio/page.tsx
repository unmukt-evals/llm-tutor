// app/studio/page.tsx
// Studio dashboard — Phase 5a skeleton, expanded in 5b, finished in 5c.
// Shows live counts for Sources, Modules, Pools, Cards, plus a Drafts entry
// point (transient, no count). Reads via getCmsIndex — zero network, O(1)
// from the SQLite mirror.
//
// Phase 6 Piece B — also surfaces "Stale source links" grouped by source so
// the user can review and clear the stale_at flag on each citing module.

import { getCmsIndex } from '@/lib/cms';
import Link from 'next/link';
import { formatRelativeTime } from '@/lib/ui/relative-time';
import { MarkReviewedButton } from '@/components/studio/MarkReviewedButton';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

export default async function StudioDashboardPage() {
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const sources = cms.getSources();
  const curriculum = cms.getCurriculum();
  const poolIds = cms.getPoolIds();
  const flashcards = cms.getFlashcards();
  const staleLinks = cms.getStaleSourceLinks();

  // Group stale links by sourceId so each source appears once with its
  // citing modules listed beneath it.
  const grouped = new Map<
    string,
    { sourceTitle: string; rows: Array<{ moduleId: string; staleAt: number }> }
  >();
  for (const link of staleLinks) {
    const g = grouped.get(link.sourceId);
    if (g) {
      g.rows.push({ moduleId: link.moduleId, staleAt: link.staleAt });
    } else {
      grouped.set(link.sourceId, {
        sourceTitle: link.sourceTitle,
        rows: [{ moduleId: link.moduleId, staleAt: link.staleAt }],
      });
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Studio</h1>
      <p className="text-sm text-slate-600">Authoring surface for the LLM Tutor curriculum.</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <DashboardCard href="/studio/sources" label="Sources" count={sources.length} />
        <DashboardCard
          href="/studio/modules"
          label="Modules"
          count={curriculum.modules.length}
        />
        <DashboardCard href="/studio/pools" label="Pools" count={poolIds.length} />
        <DashboardCard href="/studio/cards" label="Cards" count={flashcards.length} />
        <DashboardCard href="/studio/drafts" label="Drafts" count={null} />
      </div>

      <StaleLinksSection grouped={grouped} />
    </div>
  );
}

function StaleLinksSection({
  grouped,
}: {
  grouped: Map<
    string,
    { sourceTitle: string; rows: Array<{ moduleId: string; staleAt: number }> }
  >;
}) {
  if (grouped.size === 0) {
    return (
      <div className="text-sm text-slate-500" data-testid="stale-links-empty">
        ✓ no stale source links
      </div>
    );
  }

  // Sort by sourceId for stable ordering across renders.
  const entries = Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <section
      className="rounded-lg border border-amber-200 bg-amber-50/40 p-4"
      data-testid="stale-links-box"
    >
      <h2 className="text-sm font-semibold text-amber-900">Stale source links</h2>
      <p className="mt-1 text-xs text-amber-800">
        A cited source was edited. Review the citing modules and mark them reviewed once you&apos;ve
        confirmed the module still reads correctly against the new source.
      </p>
      <div className="mt-3 space-y-4">
        {entries.map(([sourceId, group]) => (
          <div key={sourceId}>
            <div className="text-sm font-medium text-slate-900">
              <span className="text-slate-500">{sourceId} · </span>
              <span>&ldquo;{group.sourceTitle}&rdquo;</span>
            </div>
            <ul className="mt-1 space-y-1">
              {group.rows
                .slice()
                .sort((a, b) => a.moduleId.localeCompare(b.moduleId))
                .map((row) => (
                  <li
                    key={`${sourceId}::${row.moduleId}`}
                    className="flex items-center gap-3 pl-4 text-sm"
                  >
                    <Link
                      href={`/studio/modules/${row.moduleId}`}
                      className="font-mono text-slate-700 hover:underline"
                    >
                      {row.moduleId}
                    </Link>
                    <span className="text-slate-500">
                      → marked stale {formatRelativeTime(row.staleAt)}
                    </span>
                    <MarkReviewedButton moduleId={row.moduleId} sourceId={sourceId} />
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function DashboardCard({
  href,
  label,
  count,
}: {
  href: string;
  label: string;
  count: number | null;
}) {
  return (
    <Link href={href}>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 hover:shadow-md">
        <div className="text-sm text-slate-600">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-slate-900">{count ?? '—'}</div>
      </div>
    </Link>
  );
}
