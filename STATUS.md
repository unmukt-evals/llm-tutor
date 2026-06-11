# LLM Tutor — Product Status

> **Single source of truth for product state.** Read this at the start of any work session; update it before you finish. Mechanism: `CLAUDE.md` instructs every session to do so.
>
> **Last updated:** 2026-06-10 · **Branch:** `main` · **Tests:** 734 passing (82 files)

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

### Recent fix
- `lazyRefresh` warm-boot bug: new entity kinds (e.g. `source`) were skipped on warm caches; now singleton files are probed every bootstrap. (`src/lib/cms/__tests__/lazy-refresh-source-probe.test.ts`)

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
| M00 Baseline | A | ✓ | _generating_ | not_started |
| M0.5 Forward pass | A | ✓ | _generating_ | not_started |
| M01 Tokenization | A | ✓ | _generating_ | not_started |
| M02 Embeddings | A | ✓ | _generating_ | not_started |
| M03 Attention | A | ✓ | _generating_ | not_started |
| M04 Transformer block | A | ✓ | _generating_ | not_started |
| M05 Pretraining | A | ✓ | _generating_ | not_started |
| M06 Post-training | A | ✓ | _generating_ | not_started |
| M07 Sampling | A | ✓ | _generating_ | not_started |
| M08 Inference (prefill/decode) | A | ✓ | _generating_ | not_started |
| M09 KV cache | A | ✓ | _generating_ | not_started |
| M10 GPU memory hierarchy | A | ✓ | _generating_ | not_started |
| M11 Long context | A | ✓ | _generating_ | not_started |
| M12 Agent memory layer | A | ✓ | _generating_ | not_started |
| B01 Eval harnesses | B | ✓ | ✓ | not_started |
| B02 RL post-training / GRPO | B | ✓ | ✓ | not_started |
| B03 RL environments & reward | B | ✓ | _generating_ | not_started |
| B04 RL training infra (async) | B | ✓ | _generating_ | not_started |
| B05 Agent architecture (FSM) | B | ✓ | _generating_ | not_started |
| B06 Simulation infrastructure | B | ✓ | _generating_ | not_started |
| B07 Interpretability | B | ✓ | _generating_ | not_started |

> Update the **MCQ pool** column to ✓ as `scripts/generate-pools.mjs` lands each pool (a pool exists when `<CURRICULUM_DIR>/mcq/<id>.json` is present).

---

## 5. Next pending items

1. **Generate the 19 missing MCQ pools.** Until done, only B01/B02 have working `/assess`. **The blocker is rate-bucket contention, not auth** — see §6. Run `node scripts/generate-pools.mjs` when no heavy Claude Code session is competing for the subscription budget; idempotent (skips existing).
2. **Begin v1 (BYOK LLM grading)** — the feature that makes "not yet" feedback and real `verified` promotion possible. Also sidesteps the rate-bucket problem permanently (separate API-key billing bucket).
3. **OSS packaging** — anchor-layer split, generic curriculum, README/LICENSE/CONTRIBUTING.

---

## 6. Gotchas / hard-won notes

- **"Modules missing" = missing MCQ pools, not missing content.** All 21 modules are authored. What's absent is the auto-generated quiz pool for 19 of them.
- **Pool-gen 429s are rate-bucket contention, NOT expired auth.** `generate-pools.mjs` uses the Claude Code subscription **OAuth** token (Keychain), which shares one output-tokens-per-minute budget with any live Claude Code session. Anthropic reserves the full `max_tokens` (8192) up front, so when a session is actively burning tokens, large generation calls 429 on the first try; a tiny call still passes. Re-auth does **not** help. Fixes: run the generator standalone when idle, or give the script an `ANTHROPIC_API_KEY` (separate bucket — and the v1 BYOK design anyway).
- **Markdown is SoT; never sed/regex-mutate notes.** Structured edits only (frontmatter round-trip; append-only for logs/cards).
- **Dev-server cache hygiene:** after adding routes, a long-running `next dev` can desync its webpack chunk graph (`Cannot find module './XXXX.js'`). Fix = kill the server, `rm -rf .next`, restart.

---

## 7. Dev quick reference

```bash
npm run dev          # local dev server (:3000)
npm test -- --run    # full vitest suite (734 tests)
npm run build        # production build
node scripts/generate-pools.mjs [ids...]   # generate missing MCQ pools (idempotent)
```
