---
type: build-spec
product: "LLM Tutor — v1 expansion"
status: spec (pre-implementation)
date: 2026-05-27
builds_on: build-spec.md (the MVP, now merged to main)
decisions_locked:
  generation_llm: Anthropic via OAuth (the user's Claude OAuth credential, NOT a pay-per-token API key). Pluggable LLM layer; API-key + Ollama as alt auth strategies.
  apply_model: review-gate — generate → tinyfish verification third-pass → show a DIFF → user accepts (or accept-all). Never silently overwrite curated content.
  transcript_input: the USER PASTES the transcript text (no YouTube scraping / channel-watching). URL sources are fetched via tinyfish.
  feel: juicy + animated, clean aesthetic (XP pops, level-up moments, animated progress rings, smooth transitions). Real interactive illustrations are non-negotiable, not a toggle.
---

# LLM Tutor v1 — Spec

> Extends the merged MVP. Three feature areas. The learning/assessment core stays local; only the source-generation pipeline calls out (Anthropic OAuth + tinyfish).

## Goal
1. **Sidebar navigation + per-module progress rings** — jump between modules instantly; a progress circle next to each.
2. **Real interactive illustrations + deeper content + juice** — replace prose-placeholder "diagrams" with actual explorable visualizations (starting with a live embedding/PCA scatter for M02); deepen the thinnest modules; add satisfying animation/gamification.
3. **Source → content pipeline** — drop a URL or paste a transcript → LLM generates/updates module content + its MCQ pool, grounded in the source → **tinyfish verification third-pass** → show a diff → user accepts → apply.

---

## Subsystem decomposition (→ 3 implementation plans)

```
┌───────────────────────────────────────────────────────────────────────┐
│ V1                                                                      │
│                                                                         │
│ V-NAV     sidebar (all modules, grouped by track) + progress rings      │  plan-v1a
│           + juice layer (animated rings, XP pops, level-up, transitions)│
│                                                                         │
│ V-VIZ     a visualization component system (pure, prop-driven, tested)  │  plan-v1b
│           + DEEPEN flagged module content (M02 first) + wire viz in      │
│                                                                         │
│ V-PIPE    source ingestion → LLM gen/update (Anthropic OAuth) →          │  plan-v1c
│           tinyfish verify 3rd-pass → diff → accept → apply (review-gate) │
└───────────────────────────────────────────────────────────────────────┘
```

Build order: V-NAV → V-VIZ (both local, no LLM) → V-PIPE (needs the OAuth/LLM + tinyfish layer). V-PIPE is checkpointed before build (novel auth + it mutates curriculum content).

---

## 1. V-NAV — sidebar + progress rings + juice (plan-v1a)

- **Sidebar** (`src/components/Sidebar.tsx`, persistent in a layout): lists all modules grouped by Track (A / B), each row = module name + a **progress ring** (SVG circle) reflecting mastery (blank=empty, fuzzy=⅓, solid=⅔, verified=full, + a distinct "open diagnosis" state). Active module highlighted. Click → navigate. Collapsible. Reads mastery from the sidecar (via the existing state read on the server layout, passed down).
- **ProgressRing** (`src/components/ProgressRing.tsx`): pure, prop-driven SVG ring; `mastery → fill fraction + color`; small + animates fill on change.
- **Juice layer:** animated ring fill (CSS/Framer-Motion-lite or CSS transitions — prefer zero-heavy-dep: CSS + a tiny motion util), an **XP pop** toast when XP is earned, a **level-up moment** when a module hits `verified`, smooth route transitions. Keep deps light (CSS-first; only add `framer-motion` if a reviewer agrees it's worth it). Respect `prefers-reduced-motion`.
- Layout: convert the app to a sidebar + content shell (`app/layout.tsx` or a route-group layout) without breaking existing pages.

## 2. V-VIZ — visualization system + content depth (plan-v1b)

**The visualization system** (`src/components/viz/`): pure, prop-driven, SSR-safe React components rendering REAL diagrams (SVG/Canvas), each unit-testable via a pure data-prep helper. First-class set:
- **EmbeddingScatter** — a 2D scatter (the "PCA projection" M02 promised): points = labeled phrases at (x,y), colored by cluster; hover shows the label; optionally draws nearest-neighbor links. Data is precomputed (the 2D coords baked into the module's content as fixtures — NO runtime model needed). Interactive: hover, maybe a "show nearest neighbor" toggle. This is the headline illustration.
- **VectorTable** — the token-embeddings table (token → a few example dims), styled, not ASCII.
- A pattern + 1–2 more reusable viz (e.g. **AttentionHeatmap** for M03, a **BarCompare** for benchmark-style numbers) so other modules can embed real visuals.

**Content depth:** the module markdown gets a new optional mechanism — a `## Visuals` block (or fenced ` ```viz {type,data} ` blocks) the reader renders via the viz system. Deepen the **thinnest / most-criticized modules first (M02 embeddings)**: expand the engineer pass into real explanation (not bullet stubs), add a baked `viz` block (precomputed scatter coords for ~20 phrases incl. the negation failure case), worked numeric examples. Establish the deepening pattern; apply to a couple more (M01, M03) as the plan allows.

**Reader integration:** the reader renders `viz` blocks inline in the relevant depth pass (mostly engineer). The DiagramPane already handles mermaid/ascii/code; viz is a new kind rendered by the viz system.

## 3. V-PIPE — source → content pipeline (plan-v1c) *(checkpoint before build)*

**Inputs** (a "+ Add source" affordance, e.g. on a module or a dedicated page): (a) a **URL** → fetched via `mcp__tinyfish__fetch_content`; (b) a **pasted transcript** (textarea). Optionally a target module (or "propose a new module").

**Pipeline (all server-side):**
```
source (URL→tinyfish fetch | pasted transcript)
   ▼
LLM GENERATE/UPDATE (Anthropic via OAuth):
   - propose updated module content (passes, visuals, sources) grounded in the source
   - propose updated/new MCQ pool (schema-valid: 4 opts, distractorMisconception, dims×difficulty)
   ▼
TINYFISH VERIFICATION THIRD-PASS (mcp__tinyfish__search/fetch):
   - independently check the proposed claims against the web / the source
   - confirm: does this actually align with the module's purpose + the curriculum's intent?
   - flag anything unverified / contradicted
   ▼
DIFF VIEW (review-gate): show old → proposed (content + MCQ + verification report)
   ▼
USER ACCEPTS (per-change or accept-all) → APPLY:
   - write module .md + mcq/<id>.json via the existing structured writers (atomic; never sed)
   - validate the new pool through validatePool before writing
```

**LLM layer** (`src/lib/llm/`): a pluggable client. **Auth strategy = Anthropic OAuth** (reads the user's Anthropic OAuth credential from local config; refreshable). API-key + Ollama as alternative strategies behind the same interface. *Open implementation detail to confirm at build start: the exact OAuth credential source (a token the user provides / the Claude Code OAuth creds / a device flow). Flag, don't guess.*

**Verification ethos:** the tinyfish third-pass is what makes sources "verifiable" — generated content isn't trusted until an independent pass confirms it aligns + is grounded. Unverified claims are surfaced in the diff, not silently applied.

**Guardrails:** generated MCQ pools MUST pass `validatePool`; generated module markdown MUST parse via the existing parser (round-trip check) before it's offered as a diff; writes are atomic structured edits; nothing applies without explicit accept.

---

## Decisions / non-negotiables
- Review-gate everywhere content mutates (no silent overwrite).
- Real visualizations, not prose placeholders.
- Anthropic OAuth for generation; learn/assess stays local.
- Juice respects `prefers-reduced-motion`.
- Each plan ends green: test + typecheck + lint + build.

## Open items to confirm at V-PIPE build start
1. Anthropic OAuth credential source/mechanism (the one genuinely-novel piece).
2. Whether viz coords are hand-precomputed per module (MVP-simple) or generated by a build-time script (later).
