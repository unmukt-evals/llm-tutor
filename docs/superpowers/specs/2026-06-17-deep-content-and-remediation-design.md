# Design — Deep module content + pre-collected assessment remediation

**Date:** 2026-06-17 · **Status:** approved (verbal), in implementation
**Origin:** founder feedback — (1) module content is trivial, doesn't prepare a reader for the assessment; needs depth, engagement, diagrams, illustrations, first-principles thinking. (2) after answering an assessment question, let the learner tie the answer back to the module ("re-learn this / tell me more"), with all of it pre-collected.

## Decisions (locked)

1. **Depth bar:** assessment-readiness, first-principles. Each module teaches enough — derived from first principles, with worked examples — that a motivated reader can answer its 12–16 question pool from understanding. **The pool is the spec.**
2. **Diagrams:** code-rendered (existing typed viz system + mermaid/ASCII) for data/flow; hand-built SVG only where a concept earns a bespoke figure, implemented as a **new typed viz component** (not an image pipeline).
3. **Remediation:** pre-collected **static** deep-dives + module-section deep-links per question. Instant, bundled, no API. (Live LLM "ask more" is a later, optional v2.)

## Feature 1 — Deep, first-principles module content

The rendering layer already supports this (reader renders full markdown via `ReactMarkdown` + `DiagramPane` + the `src/lib/viz` typed system). The gap is the **source content**: modules are outlines (M03's engineer pass = 6 bullets; its "diagram" is the sentence describing one).

**Per module, within the existing parser contract** (`src/lib/ingest/parse-module.ts` — strict; the current loose drill/stress-test formats don't even parse):
- Frontmatter preserved (`module_id`, `track`, `name`, `prerequisites`, `primary_sources`).
- `### Engineer pass`: skeleton → first-principles derivation + ≥1 worked numeric example, building to exactly what the pool tests. **Diagrams live here only** — ```mermaid (flows) + plain ``` (ASCII), ≥2.
- `### Operator pass`: real failure-mode reasoning + concrete scenarios (Track B: TrustEvals customer/eval framing).
- `### 10-year-old pass`: tight, vivid.
- `## Visuals`: ≥1 ```viz JSON block using the 4 built-in types (`attention-heatmap`, `embedding-scatter`, `vector-table`, `bar-compare`), all numbers precomputed.
- `## Application drills`: `### Drill N` subsections with exact `Scenario:`/`DC1:`/`DC2:` lines (so they parse). `## Stress-test pool`: `- board:` / `- researcher:` / `- analyst:` lines.

**Execution (this is the heavy lift):** an author→reviewer pipeline (workflow `deepen-modules`), one **author subagent** per module + a **separate reviewer subagent** that grades each module against its pool + the bar (pool coverage, first-principles, correctness, real diagrams, parse integrity, voice), with one repair pass for any that fail. Authors do not touch repo code; bespoke-figure needs are noted, not built.

## Feature 2 — Pre-collected remediation on the assessment (next phase)

Built **after** content is deep (the "re-learn this section" links are only worth anything once sections are rich).

- **Data model:** extend each pool question (optional, back-compatible) with a `remediation` block: `deepDive` (pre-written deeper explanation), `moduleRefs` (`[{sectionSlug, label}]` deep-links — "Re-learn: attention-mass dilution →"), optional `seeAlso`.
- **Reader:** add heading slugs (rehype-slug) so a deep-link opens the right pass + scrolls to the section.
- **Result UI (`McqFeedback`):** after answering, show existing explanation **+** deepDive **+** "Re-learn this" links **+** (when wrong) the misconception for the chosen option.
- **Validation:** extend `validatePool` (optional block), `loadPool` preserves it, `McqFeedback` renders it — TDD, same pattern as the `generatedAt`/`sourceHash` work.
- **Authoring:** per-question deep-dives authored against the deepened modules (subagent per pool).

## Sequencing
Content first (this workflow) → then remediation layer.

## Out of scope / follow-ups
- Bespoke SVG viz components (new typed `viz` types) for the few concepts the 4 built-ins can't express — done carefully post-fan-out to avoid parallel repo-code conflicts.
- Live LLM "ask for more" (BYOK) — v2 after static remediation ships.

## Safety
Pre-fan-out backup of all module `.md` + pools at `<CURRICULUM_DIR>/.backups/pre-deepen-<ts>/` (the vault is not git-tracked).
