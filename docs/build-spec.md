---
type: build-spec
product: "LLM Tutor"
status: spec-v1 (pre-implementation)
date: 2026-05-27
revised: 2026-05-27 — no LLM in MVP (hardwired diagnostic classifier); renamed LLM Tutor → LLM Tutor; repo ~/llm-tutor
companion: _product-plan.md
decisions_locked:
  state_model: sidecar is source of truth (no markdown write-back)
  grading: NO LLM in MVP — MCQ scoring is deterministic; the diagnostic localizer is a hardwired rules classifier (tags + distractor map); free-text drills/stress-tests are self-graded-reveal. LLM is an optional v1 enhancer.
  build_location: new repo ~/llm-tutor (Obsidian folder is read-only CURRICULUM_DIR)
  planning: build spec → per-subsystem implementation plans (writing-plans) → subagent-driven execution
---

# LLM Tutor — Build Spec

> **Goal:** A local-first, open-source web app that turns the markdown `llm-deep-dive` curriculum into a visual, self-traversable, mastery-tracked learning journey — with a depth toggle (the existing 3-pass teach), an adaptive MCQ diagnostic engine, and an honest (anti-yes-man) LLM grader.
>
> **Architecture:** Next.js (App Router, TS) reads a curriculum folder of markdown as its content DB; a single JSON sidecar (`_llmtutor-state.json`) is the source of truth for all progress/mastery/SR/assessment state; an optional BYOK LLM powers grading, MCQ generation, and the diagnostic localizer. The markdown is **read-only** to the app.
>
> **Tech Stack:** Next.js + TypeScript · gray-matter + remark/unified · React Flow (map) · mermaid + shiki (diagrams/code) · better-sqlite3 *or* JSON sidecar · Vercel AI SDK (model-agnostic, BYOK).

---

## 0. Locked decisions (from 2026-05-27 review)

1. **State model:** the sidecar `_llmtutor-state.json` is the single source of truth for mastery, XP, streaks, SR intervals, and assessment history. The app never writes to `.md`. The `llm-deep-dive` skill gets a small update so it too reads/writes the sidecar (one writer convention, no divergence). Markdown frontmatter `baseline_state` becomes a *seed/mirror*, not the live value.
2. **No LLM in the MVP — fully local, no API key.** MCQ scoring is deterministic (exact match). The diagnostic **localizer is a hardwired rules classifier** over the (difficulty × dimension) matrix + the `distractor_misconception` tags (§3.5) — no model call. Free-text drills + stress-tests are **self-graded-reveal** (reveal the model answer + double-clicks, learner self-marks against a shown rubric). An optional LLM enhancer (richer free-text grading, dumb-it-down generation, MCQ authoring assist) is **v1+, BYOK** — never required.
3. **Build in `~/llm-tutor`** (new git repo, branch `main`). The curriculum stays in Obsidian; `CURRICULUM_DIR` points at it.
4. **New first-class requirement:** an **adaptive MCQ diagnostic engine** (§3) — this is core MVP, not a later add.

---

## 1. Subsystem decomposition (boundaries → each becomes its own implementation plan)

```
┌─────────────────────────────────────────────────────────────────────┐
│  SYNAPSE                                                              │
│                                                                       │
│  S-INGEST    markdown → typed Curriculum model (parse contract §2)    │
│      │  reads CURRICULUM_DIR/*.md (READ ONLY)                         │
│      ▼                                                                │
│  S-STATE     sidecar read/write; mastery ladder; SR scheduler (§4,§7) │
│      │  owns _llmtutor-state.json (SOURCE OF TRUTH)                    │
│      ▼                                                                │
│  S-MAP       React Flow journey map; nodes by mastery; prereq edges   │
│  S-READER    module view; 3-pass depth toggle; diagram/code render    │
│  S-CARDS     flashcard review off _flashcards.md + SR schedule        │
│  S-MCQ       MCQ pool + stratified selection + DIAGNOSTIC engine (§3) │
│              + hardwired rules localizer (NO LLM)                     │
│  S-SELF      self-graded-reveal for free-text drills/stress-tests     │
│                                                                       │
│  S-LLM       (v1+, OPTIONAL) BYOK enhancer: richer grading, MCQ-gen,  │
│              dumb-it-down generation — never required                 │
│                                                                       │
│  Each box = one focused area, one implementation plan.                │
└─────────────────────────────────────────────────────────────────────┘
```

**Dependency order for building (MVP, no LLM):** S-INGEST → S-STATE → (S-MAP ∥ S-READER ∥ S-CARDS) → S-MCQ → S-SELF. S-MCQ depends only on S-STATE (records dimension profiles); its localizer is self-contained rules (§3.5). S-LLM is bolted on later without touching the MVP path.

---

## 2. Content contract (what the app reads; markdown stays read-only)

### 2.1 Frontmatter (already present — formalized)
```yaml
module_id: B01            # stable id, map node key
track: B                  # A | B | C
name: Eval harnesses & harness engineering
prerequisites: [M03, M04] # → soft-lock edges
primary_sources: [S4, S5] # Track B → resolve against _sources.md for cite popovers
# baseline_state is now a SEED only; live mastery lives in the sidecar keyed by module_id
```

### 2.2 Section contract (parser keys off these exact headings — both sample modules comply)
| Heading | Role in app |
|---|---|
| `## Why this matters` | mandatory banner; missing → "stake not authored" warning |
| `## Anchor scenarios` | anchor card (generic vs personal overlay, product-plan §10) |
| `### 10-year-old pass` | depth = **Dumb it down** |
| `### Engineer pass` | depth = **Engineer** (default); fenced ```mermaid/ASCII → diagram pane |
| `### Operator pass` | depth = **Make it matter** |
| `## Lab spec` | lab viewer (+ `labs/<id>/` if present) |
| `## Application drills` | free-text drill engine (scenario + DC1/DC2 progressive reveal) → S-GRADE |
| `## Stress-test pool` | boss engine (board/researcher/analyst) → S-GRADE; gates `verified` |
| `## Flashcard seeds` | seeds → appended to `_flashcards.md` (by the skill, not the app) |
| `## Sources` | Track B citation popovers |

### 2.3 NEW — MCQ pool artifact (one file per module)
Path: `CURRICULUM_DIR/mcq/<module_id>.json`. Generated by S-LLM from the module's engineer pass + sources + drills, then **human-curated** (Unmukt reviews/edits). Schema:

```jsonc
{
  "module_id": "B01",
  "questions": [
    {
      "id": "B01-q014",
      "difficulty": "medium",            // easy | medium | hard
      "dimension": "logic",              // topic | logic | example | extension  ← the 4 diagnostic buckets
      "stem": "An eval is 'fair' when score differences are driven by…",
      "options": [
        "the capability under test",                      // 0
        "the size of the test set",                       // 1
        "the model's parameter count",                    // 2
        "how recently the model was trained"              // 3
      ],
      "correct_index": 0,
      "distractor_misconception": {                       // maps each wrong choice → the misconception it reveals
        "1": "confuses sample size with construct validity",
        "2": "thinks capability == scale",
        "3": "confuses freshness with fairness"
      },
      "explanation": "Fairness = invariance to nuisance factors (contamination, verifier bugs, drift, paraphrase).",
      "source_ref": "S4"                                  // Track B grounding
    }
  ]
}
```

**The two tag axes are the whole trick:** every MCQ carries a `difficulty` AND a `dimension`. Difficulty drives stratified selection; dimension turns an inconsistent score into a *localized diagnosis* (§3).

**Pool size rule:** ≥ 12 per module minimum (4 dimensions × 3 difficulties), target ≥ 24 so selection has variety. `distractor_misconception` is required — it is what the diagnostic localizer reads.

---

## 3. The adaptive MCQ diagnostic engine (S-MCQ) — the heart

The user's requirement, made concrete: many MCQs, difficulty-stratified, randomly selected with guaranteed representation, a feedback loop, and — on inconsistent performance — a **double-click that localizes the failure into {topic, logic, example, extension} and curates content accordingly.**

### 3.1 The four diagnostic dimensions ↔ existing content layers (the elegant mapping)
```
dimension     what's actually broken                  remediation routes to
──────────    ────────────────────────────────────    ──────────────────────────────
topic         doesn't hold the concept at all          ### 10-year-old pass  (re-teach the shape)
logic         knows the fact, not the mechanism/why    ### Engineer pass + the diagram
example        can't ground it concretely               Lab / worked example (gen if absent)
extension      can't transfer it to a new scenario      Application drills / Operator pass / Anchor
```

### 3.2 Selection — stratified, representation-guaranteed
- A standard assessment = **6 questions**, sampled to guarantee **≥1 easy, ≥1 medium, ≥1 hard** and **≥3 distinct dimensions**. Remaining slots weighted toward the learner's current mastery (more medium/hard as they climb) and toward dimensions with stale or weak history.
- Random *within* each stratum so repeats are rare; never serve a question answered correctly in the last N sessions (anti-farming, ties to SR).

### 3.3 Performance model (lives in the sidecar)
Per module, maintain a matrix of accuracy by **(difficulty × dimension)** plus the **chosen-distractor log**:
```
                topic   logic   example  extension
   easy          .  .     .  .     .  .      .  .
   medium        ✓ ✗     ✓ ✓     ✗ .       ✗ ✗      ← the user's exact signal lives here
   hard          .  .     .  .     .  .      .  .
```

### 3.4 Inconsistency detector (the trigger)
Fire the diagnostic double-click when EITHER:
- **Non-monotonic / mixed within a band:** the learner gets some questions of a given difficulty right and others of the *same* difficulty wrong (the "medium right then medium wrong" signal), OR
- **Dimension imbalance:** one dimension < 60% accuracy while ≥ 2 others are > 80%.

A clean monotone profile (easy✓ medium✓ hard mixed) is *not* a misconception — it's just the frontier; advance normally. The detector specifically catches the *inconsistent* learner who half-knows it.

### 3.5 The localizer (double-click) — a hardwired rules classifier, NO LLM
On trigger, classify the failing dimension deterministically:
1. **Read the pattern:** compute per-dimension accuracy from the matrix; the failing dimension(s) are those below threshold while others are above (§3.4). Pull the `distractor_misconception` strings the learner kept choosing — each maps a wrong answer to a specific misconception.
2. **Probe to isolate (when ambiguous):** if ≥2 dimensions are implicated, serve 1–2 *targeted* MCQs per candidate dimension (the pool is dimension-tagged, so we pull, e.g., two `logic` and two `extension` questions) and re-score. Deterministic, fast.
3. **Classify by rule:** the dimension with the worst accuracy (tie-break: the one whose `distractor_misconception` strings recur most) wins → `{dimension, evidence: [qids + chosen distractors]}`. The "confidence" is just the accuracy gap. No model call — the tags carry the signal.

*v1 option:* an LLM can later add a free-text "explain your reasoning" probe and classify nuance the tags miss — but the rules classifier is the MVP and the always-available fallback.

### 3.6 Remediation router + re-assess
- Route the learner to the matching content layer (§3.1), with a one-line honest framing: *"You've got the concept (topic ✓) but not the mechanism — re-read the engineer pass §determinism, then I'll re-test just the logic."*
- After remediation, serve a fresh dimension-targeted mini-assessment (3 Qs in the weak dimension across difficulties). Mastery **cannot advance** on the module until the weak dimension clears the bar.
- If the same dimension fails twice post-remediation → escalate: generate a fresh worked example (example dim) or a new anchor scenario (extension dim) via S-LLM, badged AI-generated.

### 3.7 Feedback loop
- **Per question:** immediate correct/incorrect + `explanation` + *why your specific distractor was wrong* (from `distractor_misconception`).
- **Per assessment:** a dimension profile card ("solid: topic, logic · shaky: extension") that writes to the sidecar and biases (a) the SR scheduler (weak dimensions resurface sooner) and (b) the next selection.
- **Anti-yes-man:** the engine names the *specific* gap; it does not say "good effort." Getting easy+medium right does not unlock `verified` — that still requires the boss stress-test (§7).

---

## 4. Sidecar state schema (S-STATE — source of truth)
Path: `CURRICULUM_DIR/_llmtutor-state.json` (gitignorable; app-owned). Single writer convention: the app and the `llm-deep-dive` skill both read/write THIS, never each other's in-memory state.
```jsonc
{
  "version": 1,
  "modules": {
    "B01": {
      "mastery": "fuzzy",                  // blank|fuzzy|solid|verified  (the ladder, §7)
      "mastery_history": [{ "level": "fuzzy", "at": "2026-05-27T…", "via": "drill" }],
      "mcq": {
        "matrix": { "medium": { "logic": {"seen": 4, "correct": 3}, "extension": {"seen": 2, "correct": 0} } },
        "distractor_log": [{ "qid": "B01-q014", "chose": 2, "at": "…" }],
        "dimension_profile": { "topic": "solid", "logic": "solid", "example": "fuzzy", "extension": "weak" },
        "open_diagnosis": { "dimension": "extension", "confidence": 0.8, "opened_at": "…" }
      },
      "stress_test": { "board": "passed", "researcher": "not_yet", "analyst": "untested" }
    }
  },
  "flashcards": { "B01-c01": { "last_tested": "…", "interval_days": 7, "ease": "good" } },
  "xp": { "total": 320, "this_week": 320 },
  "streak": { "count": 4, "last_active": "2026-05-27", "freeze_tokens": 1 },
  "session_log": [{ "module": "B01", "at": "…", "events": ["read:engineer", "mcq:6", "diag:extension"] }]
}
```

---

## 5. Assessment without an LLM (S-MCQ scoring + S-SELF) — MVP is fully local

**MCQ scoring is deterministic** (compare to `correct_index`); the diagnostic localizer is the hardwired rules classifier in §3.5. **No model, no key, no network.**

**Free-text drills + stress-tests → self-graded-reveal:** the learner types/speaks their reasoning, then the app reveals the model answer + the double-clicks (DC1/DC2) + a short rubric drawn from the module's engineer pass + `Sources`, and the learner self-marks pass / not-yet. Honest enough when paired with the hard MCQ signal (which is *not* self-graded). This is the one spot where MVP trusts the learner — and the hard-MCQ gate keeps that honest.

### 5.1 Optional LLM enhancer (v1+, BYOK — S-LLM)
Bolt-on, never required, via Vercel AI SDK (Anthropic / OpenAI / Ollama), key in `.env.local` / OS keychain, never committed. Three jobs it *upgrades* (not enables):
1. **Richer free-text grading** → `{verdict: pass|not_yet, missing_mechanism, cite}`, anti-yes-man rubric — replaces self-grading for those who opt in.
2. **MCQ generation** (authoring-time): produce/refresh `mcq/<id>.json` from module content for human curation.
3. **Dumb-it-down / missing-pass generation** + an optional free-text localizer probe.

**Degradation is the default, not a fallback:** the MVP simply doesn't call an LLM. Turning a key on later only *adds* capability.

---

## 6. Map / Reader / Cards (S-MAP, S-READER, S-CARDS) — from product-plan §3
- **Map:** React Flow, two track lanes, nodes colored by `mastery` from the sidecar, soft prereq edges from frontmatter; top bar = streak, due-card count, weekly XP; opens with the skill's "last/queued/fuzzy" one-liner.
- **Reader:** Why-this-matters banner + anchor card + the **3-pass depth toggle** (Dumb it down / Engineer / Make it matter) + diagram pane (mermaid/shiki). Missing pass → "generate" via S-LLM, badged.
- **Cards:** review `_flashcards.md`, 7/14/30-day SR schedule for MVP; recall holds mastery, miss decays it one rung.

---

## 7. Mastery ladder integration (§ how assessment feeds blank→fuzzy→solid→verified)
```
blank ─MCQ: ≥1 easy + ≥1 medium correct, no open diagnosis─> fuzzy
fuzzy ─read all 3 passes + drill self-marked adequate + NO "weak" dimension─> solid
solid ─clear HARD MCQs across all 4 dimensions + self-graded 3-lens stress test─> verified
  ↑                                                              │
  └──── DECAY (dimension-scoped): missed SR card OR diagnostic re-open ────┘
```
The MCQ engine governs blank→fuzzy and gates fuzzy→solid (no "weak" dimension allowed). **→verified is deterministic in MVP:** pass the *hard*-difficulty MCQs in every dimension (machine-checked) plus complete the self-graded 3-lens stress test. (v1 LLM grading makes the stress-test pass machine-judged too.) Mastery **decays** — but **dimension-scoped**: a re-opened diagnosis or missed card knocks down the affected dimension, not the whole module, so one shaky bucket doesn't nuke a hard-won `solid`. XP/streaks are the thin visible skin (product-plan §5); never gate content.

---

## 8. Phasing

**MVP (your instance, fully local, NO API key, this is what you'd use):**
- S-INGEST + S-STATE (sidecar) + S-MAP + S-READER (3-pass toggle) + S-CARDS.
- **S-MCQ core:** human-curated pools for **2 pilot modules (B1 + B2)**, stratified selection (guaranteed easy/med/hard), per-question feedback (distractor → misconception), dimension profile, inconsistency detector, **hardwired rules localizer + remediation routing** (no LLM).
- **S-SELF:** self-graded-reveal for drills + stress-tests; hard-MCQ gate for `verified`.
- One-command run (`npm run dev`) against the Obsidian folder; no network calls.

**v1 (open-source-ready):**
- **Optional LLM enhancer (S-LLM, BYOK):** richer free-text grading, dumb-it-down generation, MCQ-authoring assist.
- MCQ pools curated for all modules; anchor two-layer (generic + personal overlay); `import-curriculum`; README/LICENSE/CONTRIBUTING + the content-contract spec as the "curriculum pack" doc.

**Vision:** voice answers; FSRS spaced-rep; auto-diagrams; published community curriculum packs.

---

## 9. Decomposition → implementation plans (next step after this spec)
Each gets its own `writing-plans` plan, TDD, in `~/llm-tutor/docs/plans/`:
1. `plan-01-ingest-and-state.md` (S-INGEST + S-STATE) — the foundation; build + test first.
2. `plan-02-map-reader-cards.md` (S-MAP + S-READER + S-CARDS) — the readable product.
3. `plan-03-mcq-diagnostic.md` (S-MCQ + S-SELF) — the diagnostic engine + self-graded-reveal; depends on 1 only (no LLM).
4. `plan-04-skill-sidecar-migration.md` — update `llm-deep-dive` to read/write the sidecar (single-writer convention).
5. *(v1, optional)* `plan-05-llm-enhancer.md` (S-LLM) — BYOK enhancer, bolted on without touching MVP.

MVP = plans 1–4. A shared data-model doc (`docs/plans/00-shared-model.md`) defines the TS interfaces all plans reference, so types stay consistent across subsystems.

---

## 10. Open design questions (decide before/while building)
1. **Sidecar vs SQLite:** JSON sidecar (diff-readable, simple) vs better-sqlite3 (scales, queryable). Lean JSON for MVP; the schema (§4) is storage-agnostic.
2. **MCQ authoring effort:** generated-then-curated is realistic, but curation is real human time per module. Pilot with B1+B2 to calibrate how much editing the generated pools need.
3. **Localizer cost/latency:** mostly computed from tags (cheap); the LLM tiebreaker is 1 call per diagnosis. Acceptable for one user.
4. **Decay aggressiveness:** how much does a re-opened diagnosis or missed card pull mastery down — one rung, or dimension-scoped? Lean: dimension-scoped, so a single weak dimension doesn't nuke a whole module's `solid`.
5. **Generic-anchor authoring** (open-source): net-new work before public release; not an MVP blocker (your instance uses the personal anchors as-is).

---

## 11. Self-review against the spec's own requirements
- 3-pass depth toggle → S-READER §6 ✓ · journey map → S-MAP ✓ · reward fn → §7 + product-plan §5 ✓
- "dumb it down" = 10yo pass → §2.2, §6 ✓
- sidecar source of truth → §0.1, §4 ✓ · NO LLM in MVP; hardwired rules localizer + self-graded-reveal → §3.5, §5, §8 ✓ · LLM optional v1 → §5.1 ✓
- **MCQ: many, pooled, random, easy/medium/hard with guaranteed representation** → §2.3, §3.2 ✓
- **feedback loop** → §3.7 ✓
- **diagnostic double-click → {topic, logic, example, extension} → curate content** → §3.1, §3.4–3.6 ✓
- single-writer (skill + app) → §0.1, §4, §9 ✓
