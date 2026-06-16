# LLM Tutor — Product Status

> **Single source of truth for product state.** Read this at the start of any work session; update it before you finish. Mechanism: `CLAUDE.md` instructs every session to do so.
>
> **Last updated:** 2026-06-16 · **Branch:** `main` · **Tests:** 738 passing (82 files) · **MCQ pools:** 21/21 authored

---

## 1. What this is

"Synapse" (working name) — an open-source, gamified, self-traversable learning app over a markdown LLM curriculum. Renders the curriculum as a non-linear **journey map**, lets you read each concept at **three depths** (10-year-old / engineer / operator), and earns **mastery** through demonstrated understanding (drills, stress-tests, recalled flashcards) — not pages viewed.

- **The markdown is the database.** Content lives in `CURRICULUM_DIR` (`~/Obsidian/.../Operations/Learning/LLM-Curriculum`); the app is a renderer + progress sidecar + a CMS authoring layer (Studio).
- **Two consumers:** Unmukt's personal instance (real curriculum, never committed) + a future OSS release (generic curriculum, BYO key).
- Full design rationale: `docs/product-plan.md`. CMS reframe master plan: `~/.claude/plans/tender-snacking-puffin.md`.

---

## 2. What we built

### Learner experience (MVP — from `docs/plans/plan-01..04`, `v1a/b/c`)
| Surface | Route | State |
|---|---|---|
| Journey map (2 tracks, mastery-colored nodes, prereq edges) | `/` | live |
| Module reader (3-pass depth toggle, why-this-matters, diagram pane) | `/module/<id>` | live |
| MCQ diagnostic / assessment | `/module/<id>/assess` | live **where a pool exists** (see §4) |
| Flashcard review (SR schedule) | `/flashcards` | live |

### CMS reframe (the 6-phase plan — **all phases complete, merged to `main` 2026-06-10**)
| Phase | Delivered |
|---|---|
| 1 | SQLite indexed-cache substrate (additive; no UI change) |
| 2–3 | Read-path migration onto the cache (modules, cards, MCQ) |
| 4 | Source as a first-class entity — `_sources.json` is SoT, `_sources.md` is a rendered mirror |
| 5a | Studio shell (`/studio/*`) + Sources CRUD |
| 5b | Studio Modules + Pools editors (markdown/JSON editing with live parse-preview) |
| 5c | Drafts (absorbed the old `/source` flow) + Cards editor; `/source` → permanent redirect to `/studio/drafts/new` |
| 6 | Source-cascade staleness (`module_sources.stale_at` flips on content-hash change) + dashboard stale-links surface + repo homedir scrub |

**Studio routes:** `/studio` (dashboard) · `/studio/sources` · `/studio/modules` · `/studio/pools` · `/studio/drafts` · `/studio/drafts/new` · `/studio/cards`.

### Recent fixes / enhancements
- `lazyRefresh` warm-boot bug: new entity kinds (e.g. `source`) were skipped on warm caches; now singleton files are probed every bootstrap. (`src/lib/cms/__tests__/lazy-refresh-source-probe.test.ts`)
- **Pool provenance + refresh-on-change (2026-06-11):** every MCQ pool now carries `generatedAt` (ISO) + `sourceHash` (hash of the source module markdown). `MCQPool` type / `validatePool` / `loadPool` support the fields. The generator "pulls the latest": on a default run it (re)generates a pool when **missing** or when its module markdown **changed** since `sourceHash`, and backfills the stamp on older pools. B01/B02 are stamped (and protected from auto-regen). New flags: `--dry-run`, `--stamp-only`. Pools are still **generate-once, read-statically** — the app never generates at runtime.

---

## 3. What we're planning (roadmap)

From `docs/product-plan.md` §8. None of the below is built yet.

**v1 — OSS-ready**
- LLM grading (BYOK) for drills + stress-tests → real "not yet" feedback → real `verified` promotion
- Dumb-it-down fallback generation for missing passes
- Anchor layer: generic-default anchors + personal/company overlay toggle
- Bundled generic curriculum + `import-curriculum` path (bring your own markdown)
- Consolidation sessions, operator-lines view, lab viewer (copy-to-Codex)
- README / LICENSE (MIT) / CONTRIBUTING + one-command setup

**Vision**
- Voice answers (speak reasoning, graded) + audio dumb-it-down
- Auto-generated diagrams for notes lacking one; FSRS spaced-rep; cite-the-source inline popovers (Track B)
- Curriculum-pack ecosystem (publish markdown packs like Anki decks)

---

## 4. Module status (21 modules)

Content authored for all 21. Learner level is `not_started` for all (the app is built; no study sessions logged yet — see `_progress.md`). **MCQ pool** = whether an assessment question bank exists for that module.

| Module | Track | Content | MCQ pool | Learner level |
|---|---|---|---|---|
| M00 Baseline | A | ✓ | ✓ | not_started |
| M0.5 Forward pass | A | ✓ | ✓ | not_started |
| M01 Tokenization | A | ✓ | ✓ | not_started |
| M02 Embeddings | A | ✓ | ✓ | not_started |
| M03 Attention | A | ✓ | ✓ | not_started |
| M04 Transformer block | A | ✓ | ✓ | not_started |
| M05 Pretraining | A | ✓ | ✓ | not_started |
| M06 Post-training | A | ✓ | ✓ | not_started |
| M07 Sampling | A | ✓ | ✓ | not_started |
| M08 Inference (prefill/decode) | A | ✓ | ✓ | not_started |
| M09 KV cache | A | ✓ | ✓ | not_started |
| M10 GPU memory hierarchy | A | ✓ | ✓ | not_started |
| M11 Long context | A | ✓ | ✓ | not_started |
| M12 Agent memory layer | A | ✓ | ✓ | not_started |
| B01 Eval harnesses | B | ✓ | ✓ | not_started |
| B02 RL post-training / GRPO | B | ✓ | ✓ | not_started |
| B03 RL environments & reward | B | ✓ | ✓ | not_started |
| B04 RL training infra (async) | B | ✓ | ✓ | not_started |
| B05 Agent architecture (FSM) | B | ✓ | ✓ | not_started |
| B06 Simulation infrastructure | B | ✓ | ✓ | not_started |
| B07 Interpretability | B | ✓ | ✓ | not_started |

> Update the **MCQ pool** column to ✓ as `scripts/generate-pools.mjs` lands each pool (a pool exists when `<CURRICULUM_DIR>/mcq/<id>.json` is present).

---

## 5. Next pending items

1. **Begin v1 (BYOK LLM grading)** — the feature that makes "not yet" feedback and real `verified` promotion possible. Also the durable fix for pool *regeneration* (separate API-key billing bucket; see §6 on why the OAuth script path is a dead end).
2. **OSS packaging** — anchor-layer split, generic curriculum, README/LICENSE/CONTRIBUTING.

> **MCQ pools: DONE.** All 21 modules have authored, schema-valid, stamped pools (2026-06-16). Every `/module/<id>/assess` works.

---

## 6. Gotchas / hard-won notes

- **The `generate-pools.mjs` OAuth path is a DEAD END for batch generation.** It auths with the Claude Code subscription OAuth token, which shares one rate-limit budget with any live Claude session AND expires after a few hours. A 19-pool run loses the budget fight (429 on every module) and, across backoffs, outlives the token (`OAuth token expired` mid-run). Re-auth does not help; going idle does not help. **What actually worked (2026-06-16): author the pools directly via subagents** — read each module md, write a schema-valid pool, self-validate through `node_modules/.bin/tsx scripts/pool-bridge.ts validate <file>`. This uses the harness model path (no separate rate bucket), bypassing the script entirely. The script is now only useful for `--stamp-only` / `--dry-run` (no-API) and for single-pool regen if/when an `ANTHROPIC_API_KEY` is wired in.
- **New pool files don't surface until the CMS cache rebuilds.** `/assess` and `/studio/pools` read via the SQLite cache `<CURRICULUM_DIR>/.llmtutor-cache.sqlite`, not the file directly. A warm cache only re-checks entities it already knows — it does **not** discover newly-added per-id pool files. After adding pools out-of-band, delete `.llmtutor-cache.sqlite*` (it's derived, watcher-ignored, rebuilds cold from SoT) and reboot; cold boot scans everything.
- **Markdown is SoT; never sed/regex-mutate notes.** Structured edits only (frontmatter round-trip; append-only for logs/cards).
- **Dev-server cache hygiene:** after adding routes, a long-running `next dev` can desync its webpack chunk graph (`Cannot find module './XXXX.js'`). Fix = kill the server, `rm -rf .next`, restart.

---

## 7. Dev quick reference

```bash
npm run dev          # local dev server (:3000)
npm test -- --run    # full vitest suite (738 tests)
npm run build        # production build
node scripts/generate-pools.mjs              # generate missing + refresh changed + stamp (needs idle API budget)
node scripts/generate-pools.mjs --dry-run    # preview the plan; no API calls, no writes
node scripts/generate-pools.mjs --stamp-only # backfill timestamps only; no API — safe anytime
node scripts/generate-pools.mjs M09 M10      # force-(re)generate specific pools
```
