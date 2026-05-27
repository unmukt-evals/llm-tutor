# LLM Tutor

A local-first, no-LLM-required web app that turns a folder of structured markdown into a visual, mastery-tracked learning journey. Point it at a curriculum directory, run `npm run dev`, and get a gamified learning map with a depth toggle (10-year-old / engineer / operator passes), spaced-repetition flashcards, and an adaptive MCQ diagnostic engine that localizes _why_ you're getting things wrong — no API key, no cloud, no accounts.

---

## Quick start

```bash
npm install
cp .env.local.example .env.local
# Edit .env.local: set CURRICULUM_DIR to the absolute path of your curriculum folder
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server (Next.js, hot-reload) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run test` | Run unit tests (Vitest) |
| `npm run typecheck` | TypeScript type-check without emitting |
| `npm run lint` | ESLint via `next lint` |

---

## Core concepts

### Journey map
The home screen is a React Flow node graph — one node per module, colored by mastery (`blank / fuzzy / solid / verified`), with soft prerequisite edges drawn from each module's `prerequisites:` frontmatter. Top bar shows streak, due flashcard count, and weekly XP.

### 3-depth reader
Each module has three authored passes. A persistent toggle switches between them:
- **Dumb it down** — `### 10-year-old pass`: the simplest possible mental model.
- **Engineer** (default) — `### Engineer pass`: mechanism, diagrams, code.
- **Make it matter** — `### Operator pass`: decision framing, real tradeoffs.

### Flashcards + spaced repetition
Cards live in `_flashcards.md` in the curriculum folder (` :: ` front/back format, see content contract below). The app resurfaces them on the 7/14/30-day schedule; a missed card decays the module's mastery one rung.

### MCQ diagnostic engine
Each module has a pool of questions tagged by two axes: **difficulty** (`easy / medium / hard`) and **dimension** (`topic / logic / example / extension`). A standard assessment draws 6 questions with stratified guarantees (≥1 per difficulty tier, ≥3 distinct dimensions). When performance is inconsistent — right and wrong within the same difficulty band, or one dimension lagging — the engine localizes the failure:

| Dimension | What's broken | Remediation |
|---|---|---|
| `topic` | doesn't hold the concept | re-read the 10-year-old pass |
| `logic` | knows the fact, not the mechanism | re-read the engineer pass + diagram |
| `example` | can't ground it concretely | lab / worked example |
| `extension` | can't transfer to a new scenario | application drills / operator pass |

The localizer is a deterministic rules classifier (reads `distractor_misconception` tags, no LLM call). Per-question feedback names the specific misconception your wrong choice revealed.

### Mastery ladder
`blank → fuzzy → solid → verified`. Earned by demonstrated understanding, not page views:
- **blank → fuzzy**: pass ≥1 easy + ≥1 medium MCQ with no open diagnosis.
- **fuzzy → solid**: read all 3 passes + drill self-marked adequate + no `weak` MCQ dimension.
- **solid → verified**: clear hard MCQs across all 4 dimensions + complete the 3-lens stress test (board / researcher / analyst).

Mastery **decays**: a missed SR card or a re-opened MCQ diagnosis knocks the affected dimension down, not the whole module.

### Optional LLM enhancer (v1+, BYOK)
The MVP is fully local and deterministic. An optional LLM layer (Vercel AI SDK, Anthropic / OpenAI / Ollama, key in `.env.local`, never committed) can be added later to upgrade free-text drill grading and generate missing passes. It never replaces the MCQ engine — that stays deterministic.

---

## Bring your own curriculum

The app is an engine; the markdown is the content. To author a curriculum pack:

### Folder layout
```
my-curriculum/
  B01-some-concept.md        # module files
  B02-another-concept.md
  mcq/
    B01.json                 # MCQ pools, one per module
    B02.json
  _flashcards.md             # spaced-rep deck
  _llmtutor-state.json       # progress sidecar (app-owned, gitignore this)
```

### Module frontmatter
```yaml
---
module_id: B01          # stable key; must match mcq/<module_id>.json
track: B                # A | B | C  — which map lane
name: Eval harnesses & harness engineering
prerequisites: [M03, M04]   # soft-lock edges on the map
primary_sources: [S4, S5]   # resolve against _sources.md for citation popovers
baseline_state:
  current_level: blank  # blank | fuzzy | solid | verified  (seed; live value in sidecar)
---
```

### Required section headings
The parser keys off these exact headings (both `##` and `###` matter):

```
## Why this matters          — mandatory banner; missing → "stake not authored" warning
## Anchor scenarios          — scenario card shown above the reader
### 10-year-old pass         — depth = "Dumb it down"
### Engineer pass            — depth = "Engineer" (default); fenced mermaid/ASCII → diagram pane
### Operator pass            — depth = "Make it matter"
## Lab spec                  — lab viewer
## Application drills        — free-text drill engine (scenario + DC1/DC2 progressive reveal)
## Stress-test pool          — boss engine (board / researcher / analyst lenses); gates `verified`
## Flashcard seeds           — seed list appended to _flashcards.md by the skill (not the app)
## Sources                   — Track B citation references
```

### MCQ pool — `mcq/<moduleId>.json`
Minimum 12 questions per module (4 dimensions × 3 difficulties), target ≥24 for variety. `distractor_misconception` is required — it is what the diagnostic localizer reads.

```jsonc
{
  "module_id": "B01",
  "questions": [
    {
      "id": "B01-q001",
      "difficulty": "medium",          // easy | medium | hard
      "dimension": "logic",            // topic | logic | example | extension
      "stem": "An eval is 'fair' when score differences are driven by…",
      "options": [
        "the capability under test",
        "the size of the test set",
        "the model's parameter count",
        "how recently the model was trained"
      ],
      "correct_index": 0,
      "distractor_misconception": {
        "1": "confuses sample size with construct validity",
        "2": "thinks capability == scale",
        "3": "confuses freshness with fairness"
      },
      "explanation": "One sentence grounding the correct answer.",
      "source_ref": "S4"               // optional; resolves against _sources.md
    }
  ]
}
```

### Flashcard format — `_flashcards.md`
Cards use ` :: ` (space-colon-colon-space) as the front/back separator:

```
### [B01] Eval harness components
- Created: 2026-05-27
- Last tested:
- Status: fuzzy
- Interval: 7d

**Q:** What three things does an eval harness provide?
**A:** The task set (prompts + expected behaviour) :: the runner (calls the model) :: the scorer (maps outputs to pass/fail)
```

### Progress sidecar — `_llmtutor-state.json`
The app reads and writes this file for all progress, XP, streaks, SR intervals, and MCQ matrices. It is keyed by `module_id`. Treat it as app-owned; gitignore it from your curriculum repo. The `llm-deep-dive` Claude skill (if you use it) also reads/writes this file — single-writer convention: both the app and the skill target the sidecar, never each other's in-memory state.

---

## Status / not yet

- No LLM grading in the MVP — free-text drills are self-graded-reveal (model answer shown, learner self-marks).
- Single learner only; no accounts, no cloud sync.
- MCQ pools hand-curated for 2 pilot modules (B01, B02); remaining modules need pools authored.
- FSRS spaced repetition not yet implemented — MVP uses a coarse 7/14/30-day rule.
- Lab viewer and import-curriculum CLI are v1 work.
- The optional LLM enhancer (BYOK) is planned but not wired.

---

## License

MIT — see LICENSE.
