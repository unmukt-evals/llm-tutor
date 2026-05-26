---
type: product-plan
product: "Synapse (working name)"
status: draft-v1
author: PM + founding engineer pass
date: 2026-05-27
source_of_truth: the existing llm-deep-dive markdown curriculum (this folder)
---

# Product Plan — A self-traversable, gamified learning app over the LLM curriculum

> One doc. Decision-forcing. Built ON the markdown that already lives in this folder, not a rewrite of it.

---

## 1. Vision + name

**Vision.** Turn the `llm-deep-dive` markdown curriculum into a web app that renders the existing modules as a **visual, non-linear learning map**, lets the learner read any concept at **three depths** (the 3-pass teach that's already authored — 10-year-old / engineer / operator), and **earns** mastery through demonstrated understanding (drills, stress-tests, recalled flashcards) rather than pages viewed. The markdown files stay the source of truth: edit a `.md`, the app updates. The reward function is wired to the curriculum's *existing* mastery ladder (blank → fuzzy → solid → verified) and *existing* spaced-repetition deck — no parallel scoring system. It ships open-source so any learner can point it at their own markdown curriculum.

**Name candidates (pick one):**
- **Synapse** — short, neutral, "where understanding connects." Works open-source, no TrustEvals lock-in. *(recommended)*
- **Tracelight** — nods to "trace the forward pass" + "looking inside" (interpretability) + the app *traces your understanding*. More evocative, slightly narrower.
- (backup) **Recall** / **Throughline** / **Mastergraph**.

Recommendation: **Synapse** as the OSS project name; the personal instance can carry no brand at all.

---

## 2. Who it's for + Job-to-be-Done

**Primary: Unmukt.** Founder of an AI-evals company, ex-GS/JPM, app-layer-fluent but reaching for engineer-grade mechanism. Constraints that the product must respect: working-memory is a stated constraint (→ spaced repetition is core, not a feature); strongly anti-yes-man (→ the app must be able to say "not yet"); does not write code (→ labs are *read-and-run*, never *type-it-yourself*); prefers diagrams over text walls.

> **Primary JTBD:** *"When I have 30–60 minutes, help me genuinely level up my understanding of one LLM/eval concept — and tell me honestly where I actually stand, so I can speak to it on a call or a build decision without bluffing."*

**Secondary: the open-source learner.** A self-directed engineer/PM/founder who finds the repo, clones it, points it at the bundled generic curriculum (or their own markdown), and wants a structured, gamified way through dense AI material. They do **not** have TrustEvals context — see §10 the anchor tension.

> **Secondary JTBD:** *"Give me a rigorous, self-paced path through how LLMs and evals actually work, that keeps me honest about whether I've learned it — and let me bring my own curriculum."*

Non-goal personas: classrooms / LMS admins / certification bodies. This is a single-learner self-study tool, not Canvas.

---

## 3. Core experience walkthrough (one session, end to end)

```
                        THE MAP (home)
   ┌───────────────────────────────────────────────────────┐
   │  TRACK A ──────────────●────────────────────────────   │
   │  M00▣  M0.5▣  M01� ─ M02◐ ─ M03○ ─ M04🔒 …               │
   │                          │ (prereq edge)                │
   │  TRACK B ───────────────────────────────────────────   │
   │  B1◐ ── B2○ ── B3🔒 ── B4🔒    B5○      B6🔒    B7🔒      │
   │                                                         │
   │  legend  ▣ verified  ◐ solid  ○ fuzzy  · blank  🔒 locked│
   │  streak: 4 days   due flashcards: 6   weekly XP: 320    │
   └───────────────────────────────────────────────────────┘
```

1. **Open the map.** Unmukt lands on the journey map — two track lanes (A mechanism, B training/agents/evals), nodes colored by *his actual mastery* pulled from `baseline_state` in each module's frontmatter + `_progress.md`. Prereq edges drawn from the `prerequisites:` field (B3 shows a soft lock until B1/B2 cross a threshold; B7 shows M03/M04 as soft prereqs). Top bar: streak, due-flashcard count, weekly XP. **First thing the app does, like the skill:** surface "last module, what's queued, what's flagged fuzzy" in one line.
2. **Resurface flashcards first.** If cards are due (untouched >7/14/30d per the existing SR schedule), the app offers a 2-minute warm-up: pull 2–3 due cards from `_flashcards.md`. Recall is self-graded *then verified* (see §5 honesty mechanic). This mirrors the skill's "open-session pull."
3. **Pick a module.** He taps **B1 Eval harnesses**. The module view opens on the **engineer pass by default** (the skill's "default depth"). Above it: the mandatory **Why this matters** (3 lines) and one **Anchor scenario** — rendered straight from the markdown sections.
4. **Read at a depth.** A persistent depth toggle: **`Dumb it down` (10yo) · `Engineer` (default) · `Make it matter` (operator)`**. Tapping `Dumb it down` swaps the body to the `### 10-year-old pass` section ("a harness is the racetrack, the stopwatch, and the rulebook"). One diagram renders (mermaid from the note, or the ASCII fenced block).
5. **Do a drill.** He hits **Drill**. The app pulls one of the 3 pre-canned **Application drills** ("customer scores 60% on our eval, 90% on theirs — which unfairness mode?"), shows the scenario, and asks him to *type or speak his reasoning* before revealing the double-clicks (DC1, DC2). His answer is graded (§5).
6. **Get assessed — honestly.** A **boss stress-test** is offered when he's done the drills: 2–3 questions from the **Stress-test pool** (board / researcher / analyst lens). His free-text answer is scored against a rubric derived from the module's own engineer-pass + cited sources. If it's thin, the app says so: *"Not yet — you named failure attribution but didn't distinguish reproducibility from determinism. That's the load-bearing bit. Re-read the engineer pass §determinism and retry."* No gold star for showing up.
7. **Earn mastery + XP.** Mastery only moves on *demonstrated* understanding: passing the 3-lens stress test promotes `blank→fuzzy→solid→verified` exactly as the skill defines `verified` ("passed 3-lens stress test"). XP is a thin visible layer on top of that real signal. New flashcards (the **Flashcard seeds**) get committed to `_flashcards.md`.
8. **Flashcards resurface later.** Days later, the SR scheduler resurfaces those cards on the map's top bar and at session open. Recalling them holds mastery; failing them *decays* it (solid → fuzzy) — the app is willing to take points back. That decay is the anti-vanity mechanic.

The whole loop is: **map → why-this-matters → read at depth → drill → boss → earned mastery → SR resurfacing.** It is the skill's session protocol, made visual and self-serve.

---

## 4. Feature set (MoSCoW)

```
MUST (MVP-defining)                 SHOULD (v1 / OSS-ready)
─────────────────────────────       ─────────────────────────────
• Journey map (2 tracks, nodes      • LLM-graded free-text drills
  by mastery, prereq edges)           + stress-tests (BYO key)
• Depth toggle = 3-pass teach       • Dumb-it-down fallback gen
• Markdown ingest (frontmatter        when a pass is missing
  + section parsing) as content     • Anchor layer: generic default
• Reward fn tied to existing          + personal overlay toggle
  mastery ladder + SR deck          • Lab viewer (render labs/ py,
• Flashcard review (SR schedule)      "run" via copy-to-Codex)
• Mastery write-back to .md /        • Consolidation sessions
  a sidecar progress store            (every 4 modules)
• Self-graded honesty mechanic      • Operator-lines collector view
  (recall confidence + reveal)      • Import-your-own-curriculum CLI

COULD (later)                        WON'T (yet)
─────────────────────────────       ─────────────────────────────
• Voice answers (speak reasoning)    • Multi-user / accounts / cloud sync
• Audio "dumb it down" readout       • Social/leaderboards/teams
• Diagram auto-gen for notes         • Certificates / credentials
  lacking one                        • In-app code editor (he doesn't type)
• Spaced-rep tuning / FSRS algo      • Native mobile apps
• "Cite the source" inline popovers  • Authoring UI (edit md in-app) —
  for Track B                          edit the .md in Obsidian instead
```

The three the user named — **depth toggle, journey map, reward function** — are all Must.

---

## 5. The reward / engagement function (concrete mechanics)

The spine: **mastery is the real currency; XP/streaks are the thin visible skin over it.** Mastery is the curriculum's own ladder, earned only by *demonstrated* understanding.

**Mastery ladder (existing — do not reinvent):**

```
blank ──drill passed──> fuzzy ──read all 3 passes + drill DC2──> solid ──3-lens stress test passed──> verified
  ↑                                                                                    │
  └──────────────── DECAY: failed SR card pulls one rung down ─────────────────────────┘
```

- **blank → fuzzy:** answered one application drill credibly (LLM-graded ≥ threshold) *or* self-rated + spot-check passed. Maps to skill's "heard of it, can't fully explain" → "getting there."
- **fuzzy → solid:** read all three passes *and* completed a drill through DC2 with a graded-adequate reasoning chain. ("can explain to a peer.")
- **solid → verified:** **passed the 3-lens stress test** (board/researcher/analyst), graded against a source-grounded rubric. This is verbatim the skill's definition of `verified`.
- **Decay is real:** a missed SR card on a module drops it one rung. This is the single most important anti-vanity mechanic — *you can lose mastery you don't maintain.*

**XP (the visible layer):**
- Reading a pass: small XP (5). Reading all 3 passes: bonus (15). *Capped per module* so you can't farm XP by re-reading.
- Drill answered + graded adequate: 25. Stress-test lens passed: 40 each.
- Flashcard recalled correctly on an SR-due card: 10. (Recalling a *not-yet-due* card: 0 — no farming.)
- **Promoting a module to `verified`: 200 + the node lights up on the map.**
- XP exists to make a session feel like it closed with something; it never gates content or fakes competence.

**Streaks:** a day with ≥1 *graded* activity (drill, stress-test, or SR review) extends the streak. A day of pure reading does **not**. Streaks reward the honest behaviors. One "freeze" token per week so a missed day doesn't nuke a long streak (anti-punishment, but scarce).

**Unlocks:** prereq edges from frontmatter gate modules *softly* — B3 shows "recommended after B1, B2 reach `fuzzy`," dismissible (the skill says tracks/modules are independent; we respect that — soft, not hard, locks). Hard-locking would fight the skill's "B1/B5 need no prerequisite" design.

**Boss stress-tests:** each module's **Stress-test pool** is the "boss." Beating it (all 3 lenses graded-adequate) is the only path to `verified`. Consolidation sessions (every 4 modules, per the skill) are **mini-bosses**: cross-module drills, no new content.

**Progress visualization:** the map itself is the dashboard. Secondary: a per-track mastery bar (e.g. "Track B: 2 solid, 1 fuzzy, 4 blank"), a flashcard-health gauge (how many cards are overdue = "memory debt"), and the operator-lines collected.

### Anti-cargo-cult gamification — what we deliberately do NOT do

- **No XP for page views as a proxy for learning.** Reading is capped and cheap; the big numbers come from demonstrated recall and passing bosses. (User explicitly values substance over vanity metrics.)
- **No "everyone gets a gold star."** The grader can and will return "not yet." Mastery decays. There is no path to `verified` without passing the 3-lens stress test.
- **No leaderboards, no badges-for-badges, no streak-shaming.** Single-learner tool; competition is against your own prior understanding. The one freeze token keeps streaks from becoming a stress source.
- **No fake difficulty / no grind.** You can't farm XP by replaying easy drills or re-reading. The reward is calibrated to *new* demonstrated understanding.
- **No dark patterns** (push notifications guilt-tripping, "you'll lose everything!"). Memory debt is shown neutrally as a gauge, not a threat.
- **No mastery without honesty:** self-rated recall is always followed by a reveal + verify step, so the learner can't quietly inflate themselves.

---

## 6. Information architecture & the content contract

**Principle: the markdown is the database.** The app is a *renderer + a progress sidecar*. No content lives in the app's own store except progress/XP/SR state.

**Content contract — frontmatter (already present, formalize it):**

```yaml
module_id: B01            # stable id; map node key
track: B                  # A | B | C → which lane
name: Eval harnesses & harness engineering
status: not_started | in_progress | completed | needs_review
prerequisites: [M03, M04] # → soft-lock edges on the map
baseline_state: { last_checked: "", current_level: "blank|fuzzy|solid|verified" }
primary_sources: [S4, S5] # Track B → resolve against _sources.md for cite popovers
```

**Section parsing contract** (parser keys off these exact `##`/`###` headings, which both sample modules already use):

```
## Why this matters         → mandatory banner; if missing, app shows a "stake not authored" warning (mirrors skill's refuse-to-proceed)
## Anchor scenarios         → anchor card (see §10 for generic vs personal handling)
## Teach outline
   ### 10-year-old pass      → depth = "Dumb it down"
   ### Engineer pass         → depth = "Engineer" (DEFAULT)   + fenced ``` ASCII or mermaid → diagram pane
   ### Operator pass         → depth = "Make it matter"
## Lab spec                  → lab viewer (+ link to labs/<id>/ if present)
## Application drills        → drill engine (scenario + DC1/DC2 progressive reveal)
## Stress-test pool          → boss engine (board/researcher/analyst lenses)
## Flashcard seeds           → seed list → committed to _flashcards.md on pass
## Sources                   → Track B citations
## Session log               → append-only; app appends a structured entry on session close
```

**Depth-pass mapping + fallback:** `Dumb it down → 10-year-old`, `default → engineer`, `Make it matter → operator`. **If a pass is absent**, the app does NOT silently hide the toggle: it offers **"generate this pass"** via the runtime LLM, *grounded only in the other passes + cited sources of that same module*, with a visible **`AI-generated, not author-reviewed`** badge and a one-click "save to .md as a draft pass" so the human can promote it. Guardrail: generation is constrained to the module's own content (no open-web hallucination); for Track B it must cite from the module's `Sources` block.

**Progress / mastery storage — two-layer, decided:**
- **Source-of-truth mastery** lives back in the module `.md` frontmatter (`baseline_state.current_level`, `status`) and `_progress.md` — so Obsidian and the skill stay authoritative and a git diff shows learning over time. The app **writes back** to these on mastery change (with a clear, minimal diff; the skill already edits these files).
- **Ephemeral/granular state** (XP, streak, per-card SR intervals, per-drill attempt history) lives in a **sidecar** `_app-state.json` (or SQLite) in the same folder — gitignorable, app-owned, never pollutes the human-readable notes.

```
folder/
  B01-eval-harnesses.md      ← content + mastery frontmatter (human + app write)
  _progress.md               ← canonical progress (human + app write)
  _flashcards.md             ← SR deck (human + app write, append cards)
  _operator_lines.md         ← collected lines (app can append)
  _app-state.json            ← XP/streak/SR-intervals/attempts (app-only, gitignored)
  labs/B01/harness.py        ← rendered read-only in lab viewer
```

Flashcards: parse `_flashcards.md` (front/back + `module` + `last-tested` tags as the skill specifies); the SR scheduler uses the existing 7/14/30-day resurface rule for MVP (upgrade to FSRS in `Could`).

---

## 7. Tech approach (opinionated, boring, shippable, OSS-friendly)

```
Next.js (App Router, TS)  ──reads──>  ./curriculum/*.md  (local markdown = the DB)
   │                                     ▲
   ├─ gray-matter (frontmatter) + remark/unified (sections) + mermaid + shiki (code)
   ├─ React Flow  → the journey map (nodes/edges from frontmatter)
   ├─ SQLite (better-sqlite3) OR _app-state.json  → XP/streak/SR sidecar
   └─ /api/grade, /api/dumb-it-down  → calls LLM with the user's OWN key (BYOK)
                                         model-agnostic via Vercel AI SDK
```

- **Why Next.js + local files:** runs with `npm install && npm run dev`, reads markdown straight off disk, trivial for a contributor to clone and run. No DB server to stand up. Server components read the `.md`; writes go through a tiny API route that edits the file + sidecar.
- **Map:** **React Flow** — purpose-built for node/edge graphs, nodes styled by mastery, edges from `prerequisites`. (Don't hand-roll SVG.)
- **Markdown:** `gray-matter` for frontmatter, `remark`/`unified` to split on the heading contract, `mermaid` + `shiki` for diagrams/code. Render is deterministic from the file.
- **Storage:** SQLite via `better-sqlite3` for the sidecar (fast, file-based, zero-config) — or plain JSON if we want it diff-readable. Mastery write-back uses a careful frontmatter editor (`gray-matter` round-trip) so we never clobber human-authored sections. **Never use sed/regex to mutate notes** (per house rule — granola incident); structured edits only.
- **LLM at runtime — two jobs, both BYOK:**
  1. **Grading** drills & stress-tests (free-text answer → rubric → pass/not-yet + specific gap). This is what makes the honesty mechanic possible.
  2. **Dumb-it-down fallback** when a pass is missing.
- **BYOK:** open-source users paste their own API key into a local settings screen (stored in `.env.local` / OS keychain, never committed). Model-agnostic via the **Vercel AI SDK** so it works with Anthropic / OpenAI / local Ollama. **Graceful degradation: with no key, the app is fully usable as a reader + map + flashcards + self-graded drills** — only LLM-grading and dumb-it-down-generation are disabled (and clearly labeled). This matters: the substantive value works offline; the LLM is an enhancer, not a gate.
- **Grading honesty:** the grader prompt is explicitly anti-yes-man (mirrors the skill's hard rule): it's instructed to identify the *specific* missing mechanism, to return "not yet" when the answer is thin, and to never pass an answer that only restates the question. Rubrics are derived from the module's own engineer pass + `Sources`, so grading is grounded, not vibes.

---

## 8. Phasing

**MVP — the smallest lovable thing Unmukt would use this month (no backend, local-only):**
- Journey map (React Flow) of both tracks, nodes colored by `current_level` read from frontmatter; soft prereq edges.
- Module reader with the **3-pass depth toggle** (Dumb it down / Engineer / Make it matter) + Why-this-matters banner + diagram pane.
- Flashcard review using `_flashcards.md` + the existing 7/14/30-day SR rule; recall holds/decays mastery.
- Reward layer: mastery ladder write-back to frontmatter + XP/streak in the JSON sidecar; **self-graded** drills/stress-tests (confidence → reveal model answer/DCs → user marks pass-or-not, with the honesty reveal step). *(LLM grading deferred to v1 so MVP needs no key.)*
- Runs with `npm run dev` against this folder; zero accounts, zero cloud.

**v1 — open-source-ready:**
- **LLM grading (BYOK)** for drills + stress-tests → real "not yet" feedback → real `verified` promotion. Dumb-it-down fallback generation for missing passes.
- **Anchor layer:** generic-default anchors + personal/TrustEvals overlay toggle (§10), with the personal anchors moved to a separate overlay file so the shippable repo is clean.
- Bundled **generic curriculum** (Track A + a sources-grounded Track B with the TrustEvals anchors stripped to generic ones) + an `import-curriculum` path so users bring their own markdown.
- Consolidation sessions, operator-lines view, lab viewer with copy-to-Codex.
- README, license, CONTRIBUTING, `npx create` or one-command setup.

**Vision:**
- Voice answers (speak your reasoning, graded) and audio dumb-it-down — fits "doesn't type code," low-friction recall.
- Auto-generated diagrams for notes lacking one; FSRS spaced-rep; "cite-the-source" inline popovers for Track B.
- A small ecosystem: people publish their own `Synapse` curricula (markdown packs) the way people publish Anki decks — the app is the engine, the markdown is the content.

---

## 9. Open-source strategy

- **License: MIT.** It's a learning engine; maximize adoption and forking. (If we want curriculum-content protection, dual-license: MIT for the app code, CC-BY-SA for any bundled *generic* curriculum content. The personal/TrustEvals curriculum is simply *not in the repo*.)
- **Positioning:** *"An open-source, gamified, self-traversable learning engine for dense technical material. Point it at a folder of structured markdown and it becomes a mastery-tracked learning map. Bring your own curriculum, bring your own API key."* Think **"Anki meets a skill-tree, for markdown curricula."** The anti-feature is the hook: *it tells you when you're wrong.*
- **Content separation (clean cut):**
  - `app/` — the engine. Ships. MIT.
  - `curriculum/` (bundled example) — the **generic** Track A + B, anchors genericized. Ships. CC-BY-SA.
  - **Unmukt's personal instance** — his real curriculum (TrustEvals anchors, operator lines, his progress, `_app-state.json`) stays in *his Obsidian folder*, never committed to the public repo. The app reads whatever folder you point `CURRICULUM_DIR` at. So the same binary serves both; only the content differs.
- **Contribution model:** contributions to the *engine* (PRs, issues). Curriculum packs as separate repos people can share (a lightweight "curriculum pack" spec = the frontmatter + section contract in §6, documented). A `CONTRIBUTING.md` that defines the content contract is the most important doc for adoption — it's what lets others author packs.

---

## 10. Risks & open questions

**The TrustEvals-anchor tension — clear position taken:**
The curriculum's `## Anchor scenarios` and operator passes are heavily TrustEvals-specific ("a customer's agent scores 60% on our eval…"). Generic learners have no such context. **Decision: anchors become a two-layer field, not a rewrite.**
- The shippable curriculum ships **generic-default anchors** (e.g. for B1: *"You run a model on two test sets and get 60% vs 90% — which harness is wrong?"* — same mechanism, no TrustEvals).
- A **personal/company overlay** (a sibling `*.anchors.md` or a frontmatter `anchors_overlay:` pointer) carries domain-specific anchors. The app shows the overlay when present, generic otherwise.
- v1+ adds **bring-your-own-anchor**: a setup step where the learner names their company/product, and the runtime LLM *re-anchors* the generic scenario to their world (clearly badged as generated). This turns the tension into a feature: the app personalizes anchors to *any* learner's context.
- **Why this position:** it preserves the substance (the mechanism is universal — the unfairness modes, GRPO eliminating the critic, SAE clamping — none of that is TrustEvals-specific), ships clean, and keeps Unmukt's sharp personal anchors as an *optional richer layer* rather than deleting them or leaking them.

**Other honest risks / open questions:**
1. **LLM grading cost & latency.** Every stress-test/drill grade is an API call. For a single user it's pennies and a 2–4s wait — fine. But it's the thing that makes "not yet" real. *Open Q: is self-graded-with-honesty-reveal good enough for MVP (it is for one disciplined user), reserving LLM grading for v1? — proposed yes.*
2. **Grader trustworthiness vs. anti-yes-man.** An LLM grader can itself be a yes-man (the exact failure the skill forbids). Mitigation: rubric-grounded prompts + a calibration pass + showing the learner *why* (the specific missing mechanism) so they can contest it. But this needs real prompt-engineering iteration. *Open Q: how strict is too strict before it's discouraging rather than honest?*
3. **Write-back safety.** The app mutates human-authored `.md` (frontmatter + appended session logs + flashcards). Risk of clobbering Obsidian edits or fighting Granola-style full-file overwrites. Mitigation: structured frontmatter round-trip only, append-only for logs/cards, never touch teach sections, and consider read-only-content + sidecar-only-state mode as a safe default. *Open Q: should the app write back to `.md` at all, or keep ALL state in the sidecar and treat markdown as strictly read-only?* (Read-only is safer; write-back is what keeps Obsidian/the skill authoritative. Leaning: write back ONLY mastery + append-only logs/cards, everything else sidecar.)
4. **Two systems editing the same files** (the `llm-deep-dive` skill *and* the app both update `_progress.md`/frontmatter/`_flashcards.md`). Need a single convention so they don't diverge. *Open Q: does the app become the primary writer, with the skill reading app state — or vice versa?*
5. **Spaced-rep fidelity.** The skill's 7/14/30 rule is coarse; FSRS is better but heavier. Fine for MVP, revisit.
6. **Scope creep toward an LMS.** The "Won't-yet" list must hold — accounts, multi-user, certificates are how this becomes a bloated product nobody finishes. Single-learner discipline is the moat.
