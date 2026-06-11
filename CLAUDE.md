# LLM Tutor — Working Instructions

## Start here, every session

**Before doing anything else, read [`STATUS.md`](./STATUS.md).** It is the single source of truth for what's built, what's planned, per-module status, and the next pending items.

**Before you finish a work session, update `STATUS.md`** to reflect what changed — shipped features, module/pool status (§4 table), new pending items, and any new gotcha worth saving (§6). Keep it lean; subtract stale lines rather than appending forever.

## Project shape

- "Synapse" (working name): an OSS, gamified learning app over a markdown LLM curriculum. Next.js (App Router, TS) + SQLite cache.
- **The markdown is the database.** Content lives in `CURRICULUM_DIR` (an Obsidian folder), not in the repo. The app renders it, tracks progress in a sidecar, and authors it via the Studio surface (`/studio/*`).
- Design rationale: `docs/product-plan.md`. CMS reframe plan: `~/.claude/plans/tender-snacking-puffin.md`.

## Conventions

- **Markdown is SoT — never sed/regex-mutate notes.** Structured edits only (frontmatter round-trip; append-only for logs/cards).
- Tests are expected green before any completion claim: `npm test -- --run`.
- After adding routes, if `next dev` throws `Cannot find module './XXXX.js'`, the dev server's chunk graph is stale: kill it, `rm -rf .next`, restart.

## MCQ pool generation gotcha

`node scripts/generate-pools.mjs` 429s are **rate-bucket contention, not expired auth.** The script uses the Claude Code subscription OAuth token, which shares one output-tokens-per-minute budget with any live Claude Code session. Run it standalone when idle, or wire in `ANTHROPIC_API_KEY` (separate bucket). Re-auth does not help. Full detail in `STATUS.md` §6.
