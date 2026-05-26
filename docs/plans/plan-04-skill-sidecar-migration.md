# Skill Sidecar Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `llm-deep-dive` skill read/write mastery state from `_llmtutor-state.json` (the single sidecar), so the skill and the Next.js app never diverge on mastery truth.

**Architecture:** One-time seed script reads all module frontmatter `baseline_state.current_level` fields + `_progress.md` baseline tables → writes a valid `TutorState` JSON to `$CURRICULUM_DIR/_llmtutor-state.json`. Then `SKILL.md` is edited in-place (Edit tool, exact-string replacements, no sed) so every read/write of mastery targets the sidecar instead of `_progress.md`. `_progress.md` is demoted to a human-readable mirror: the skill re-renders it from the sidecar at close, but the sidecar is the authoritative store. The contract between the skill (Claude agent) and the app (Next.js S-STATE) is: both read/write `_llmtutor-state.json`; the app owns the schema; last writer on disjoint keys wins (the skill only touches `modules[id].mastery`, `modules[id].masteryHistory`, `modules[id].stressTest`, and `sessionLog`; the app additionally owns `mcq`, `flashcards`, `xp`, `streak`).

**Tech Stack:** Bash + Python 3 (seed script, stdlib only — no pip installs) · Edit tool (structured, exact-string) · Obsidian vault markdown (read-only for seed; `_progress.md` rendered as mirror post-migration).

---

## Files touched

| File | Action | Role |
|---|---|---|
| `$CURRICULUM_DIR/_llmtutor-state.json` | **Create** (seed script output) | Sidecar — single source of truth |
| `/Users/unmukt/llm-tutor/scripts/seed-sidecar.py` | **Create** | One-time migration script; reads all module `.md` frontmatter + `_progress.md`; emits valid `TutorState` JSON |
| `/Users/unmukt/.claude/skills/llm-deep-dive/SKILL.md` | **Modify** (4 Edit-tool edits) | Skill invocation + baseline-checkpoint steps updated to read/write sidecar |

`$CURRICULUM_DIR` = `/Users/unmukt/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum`

---

## Contract (single-writer-on-file, disjoint-key convention)

Both the `llm-deep-dive` skill (Claude agent) and the Next.js app (S-STATE) share one file. To eliminate conflict:

- **Skill owns:** `modules[id].mastery`, `modules[id].masteryHistory`, `modules[id].stressTest`, `sessionLog`.
- **App owns:** `modules[id].mcq`, `flashcards`, `xp`, `streak`.
- **Both read** the full state on every open; **both write** the full state (read-modify-write) but only modify their respective key groups.
- **Atomic write protocol:** write to a temp file (`_llmtutor-state.json.tmp`) then rename — avoids partial reads on slow disks. The seed script and the skill instructions both follow this protocol.
- **Last-writer-wins on disjoint keys** is safe precisely because the key groups do not overlap. A merge conflict (both writers touching the same key simultaneously) cannot happen in normal use because the skill is interactive (human in the loop) and the app is idle when the skill runs.
- **Schema owner:** the app (S-STATE). If the app adds new top-level keys the skill does not know about, the skill's read-modify-write preserves them (Python `json.load` → mutate only known keys → `json.dump` full object).

---

## Task 1 — Create the seed script

**Files:**
- Create: `/Users/unmukt/llm-tutor/scripts/seed-sidecar.py`

The seed script is run **once** (or re-run safely — it is idempotent: it never overwrites a `mastery` value that is already non-`blank` in an existing sidecar). It reads every `*.md` in `CURRICULUM_DIR`, extracts `module_id` and `baseline_state.current_level` from YAML frontmatter, maps the `current_level` string to a `Mastery` value, and emits a valid `TutorState` v1 JSON.

Mastery mapping from `_progress.md` / frontmatter → sidecar:
- `null` / empty / missing → `"blank"`
- `"blank"` → `"blank"`
- `"fuzzy"` → `"fuzzy"`
- `"solid"` → `"solid"`
- `"verified"` → `"verified"`

- [ ] **Step 1.1 — Verify the scripts/ directory exists (or create it)**

```bash
ls /Users/unmukt/llm-tutor/
```

Expected: `app/`, `components/`, `src/`, `docs/`, and possibly `scripts/`. If `scripts/` is absent, it will be created by writing the file there.

- [ ] **Step 1.2 — Write the seed script**

Use the Write tool to create `/Users/unmukt/llm-tutor/scripts/seed-sidecar.py` with the following content:

```python
#!/usr/bin/env python3
"""
seed-sidecar.py — One-time (idempotent) migration from _progress.md / module
frontmatter into _llmtutor-state.json.

Usage:
    python3 seed-sidecar.py [--curriculum-dir PATH] [--dry-run]

Defaults:
    --curriculum-dir  ~/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum
    --dry-run         false  (pass the flag to print JSON without writing)
"""

import argparse
import json
import os
import pathlib
import re
import tempfile
from datetime import datetime, timezone

CURRICULUM_DIR_DEFAULT = os.path.expanduser(
    "~/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum"
)
SIDECAR_FILENAME = "_llmtutor-state.json"
VALID_MASTERY = {"blank", "fuzzy", "solid", "verified"}
NOW_ISO = datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Minimal YAML frontmatter parser (stdlib only — no PyYAML needed for this
# flat/inline format). Handles two frontmatter styles:
#
#   Style A (inline):  baseline_state: { last_checked: "", current_level: "blank" }
#   Style B (block):   baseline_state:\n  last_checked: null\n  current_level: null
# ---------------------------------------------------------------------------

def _extract_frontmatter_text(md_text: str) -> str | None:
    """Return the raw text between the first pair of '---' delimiters."""
    lines = md_text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    end = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end = i
            break
    if end is None:
        return None
    return "\n".join(lines[1:end])


def _parse_simple_frontmatter(fm_text: str) -> dict:
    """
    Parse a flat (non-nested) YAML block into a dict of string values.
    Handles inline objects for baseline_state well enough for our needs.
    """
    result: dict = {}
    for line in fm_text.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, raw_val = line.partition(":")
        key = key.strip()
        val = raw_val.strip()
        # Strip inline YAML comments
        val = val.split("#")[0].strip()
        result[key] = val
    return result


def _extract_module_id_and_level(md_path: pathlib.Path) -> tuple[str, str] | None:
    """
    Return (module_id, mastery_level) from a module .md file, or None if the
    file has no module_id frontmatter (e.g. _progress.md, _flashcards.md).
    """
    try:
        text = md_path.read_text(encoding="utf-8")
    except OSError:
        return None

    fm_text = _extract_frontmatter_text(text)
    if fm_text is None:
        return None

    flat = _parse_simple_frontmatter(fm_text)
    module_id = flat.get("module_id", "").strip('"').strip("'")
    if not module_id:
        return None

    # baseline_state can be inline:  { last_checked: "", current_level: "blank" }
    # or it sets nothing (block style sub-keys parsed separately below).
    level = "blank"

    bs_inline = flat.get("baseline_state", "")
    if bs_inline:
        # Try to extract current_level from inline object notation
        m = re.search(r'current_level\s*:\s*["\']?(\w+)["\']?', bs_inline)
        if m:
            candidate = m.group(1).lower()
            if candidate in VALID_MASTERY:
                level = candidate
            elif candidate in ("null", "none", ""):
                level = "blank"
    else:
        # Block style: look for a line "  current_level: <val>" right after baseline_state
        for sub_line in fm_text.splitlines():
            if re.match(r'\s+current_level\s*:', sub_line):
                m = re.search(r'current_level\s*:\s*["\']?(\w+)["\']?', sub_line)
                if m:
                    candidate = m.group(1).lower()
                    level = candidate if candidate in VALID_MASTERY else "blank"
                break

    return module_id, level


def build_default_module_state(mastery: str, module_id: str) -> dict:
    """Return a default ModuleState dict seeded with the given mastery."""
    return {
        "mastery": mastery,
        "masteryHistory": [
            {
                "level": mastery,
                "at": NOW_ISO,
                "via": "seed-sidecar-migration",
            }
        ],
        "mcq": {
            "matrix": {},
            "distractorLog": [],
            "dimensionProfile": {
                "topic": "untested",
                "logic": "untested",
                "example": "untested",
                "extension": "untested",
            },
            "openDiagnosis": None,
        },
        "stressTest": {
            "board": "untested",
            "researcher": "untested",
            "analyst": "untested",
        },
    }


def build_default_tutor_state(modules_dict: dict) -> dict:
    """Return a full TutorState v1 dict with the given modules block."""
    return {
        "version": 1,
        "modules": modules_dict,
        "flashcards": {},
        "xp": {"total": 0, "thisWeek": 0},
        "streak": {"count": 0, "lastActive": NOW_ISO[:10], "freezeTokens": 1},
        "sessionLog": [],
    }


def atomic_write_json(path: pathlib.Path, data: dict) -> None:
    """Write JSON atomically: temp file → rename."""
    tmp_path = path.with_suffix(".json.tmp")
    try:
        tmp_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        tmp_path.rename(path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--curriculum-dir",
        default=CURRICULUM_DIR_DEFAULT,
        help="Absolute path to CURRICULUM_DIR",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the JSON that would be written without touching the file",
    )
    args = parser.parse_args()

    curriculum_dir = pathlib.Path(args.curriculum_dir).expanduser().resolve()
    if not curriculum_dir.is_dir():
        raise SystemExit(f"ERROR: CURRICULUM_DIR not found: {curriculum_dir}")

    sidecar_path = curriculum_dir / SIDECAR_FILENAME

    # ------------------------------------------------------------------
    # 1. Load existing sidecar if it exists (idempotency: preserve non-blank)
    # ------------------------------------------------------------------
    existing_state: dict | None = None
    if sidecar_path.exists():
        try:
            existing_state = json.loads(sidecar_path.read_text(encoding="utf-8"))
            print(f"Found existing sidecar at {sidecar_path} — will preserve non-blank mastery.")
        except json.JSONDecodeError as e:
            raise SystemExit(f"ERROR: existing sidecar is malformed JSON: {e}")

    existing_modules: dict = {}
    if existing_state:
        existing_modules = existing_state.get("modules", {})

    # ------------------------------------------------------------------
    # 2. Walk all *.md files in CURRICULUM_DIR (non-recursive: top level only)
    #    and collect (module_id, current_level) pairs.
    # ------------------------------------------------------------------
    seed_modules: dict = {}
    md_files = sorted(curriculum_dir.glob("*.md"))
    for md_path in md_files:
        result = _extract_module_id_and_level(md_path)
        if result is None:
            continue
        module_id, level = result
        seed_modules[module_id] = level
        print(f"  Found: {module_id:12s} → mastery={level!r:12s}  ({md_path.name})")

    if not seed_modules:
        raise SystemExit(
            "ERROR: no module_id frontmatter found in any .md file. "
            "Check --curriculum-dir."
        )

    # ------------------------------------------------------------------
    # 3. Build the modules block — idempotent: skip overwrite if existing
    #    mastery is already non-blank (don't regress earned progress).
    # ------------------------------------------------------------------
    merged_modules: dict = {}
    for module_id, seeded_level in seed_modules.items():
        existing_mod = existing_modules.get(module_id)
        if existing_mod:
            existing_mastery = existing_mod.get("mastery", "blank")
            if existing_mastery != "blank":
                # Preserve earned progress — do not overwrite with seed value
                print(
                    f"  Preserve: {module_id:12s} mastery={existing_mastery!r} (skipping seed={seeded_level!r})"
                )
                merged_modules[module_id] = existing_mod
                continue
        # No existing entry, or existing entry is blank → seed it
        merged_modules[module_id] = build_default_module_state(seeded_level, module_id)

    # Carry forward any existing modules NOT in the current .md scan
    # (e.g. modules deleted from disk but with progress — preserve them)
    for module_id, mod_state in existing_modules.items():
        if module_id not in merged_modules:
            print(f"  Carry forward orphaned: {module_id}")
            merged_modules[module_id] = mod_state

    # ------------------------------------------------------------------
    # 4. Build final TutorState, reusing existing top-level keys if present
    # ------------------------------------------------------------------
    if existing_state:
        final_state = dict(existing_state)
        final_state["modules"] = merged_modules
        final_state["version"] = 1  # ensure version is set
    else:
        final_state = build_default_tutor_state(merged_modules)

    # ------------------------------------------------------------------
    # 5. Output
    # ------------------------------------------------------------------
    json_str = json.dumps(final_state, indent=2, ensure_ascii=False) + "\n"

    if args.dry_run:
        print("\n--- DRY RUN — sidecar JSON that would be written ---")
        print(json_str)
        return

    atomic_write_json(sidecar_path, final_state)
    print(f"\nWrote sidecar: {sidecar_path}")
    print(f"  Modules seeded: {len(merged_modules)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 1.3 — Verify the script parses correctly (syntax check)**

```bash
python3 -c "import py_compile; py_compile.compile('/Users/unmukt/llm-tutor/scripts/seed-sidecar.py', doraise=True)" && echo "Syntax OK"
```

Expected output: `Syntax OK`

- [ ] **Step 1.4 — Dry-run the script against the real curriculum directory**

```bash
python3 /Users/unmukt/llm-tutor/scripts/seed-sidecar.py \
  --curriculum-dir "/Users/unmukt/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum" \
  --dry-run 2>&1 | head -60
```

Expected: a list of ~20 `Found:` lines (all Track A + B modules), each showing `mastery="blank"` (since all are `not_started`), followed by a valid JSON block starting with `{"version": 1, "modules": {`.

Verify manually:
- All 20 module IDs appear (M00, M0.5, M01–M12, B01–B07)
- Every mastery value is `"blank"` (all modules are `not_started` in `_progress.md`)
- `xp.total` is `0`, `streak.count` is `0`
- `modules["B01"].mcq.dimensionProfile` has four `"untested"` entries

---

## Task 2 — Run the seed and produce the sidecar

- [ ] **Step 2.1 — Run the seed script for real**

```bash
python3 /Users/unmukt/llm-tutor/scripts/seed-sidecar.py \
  --curriculum-dir "/Users/unmukt/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum"
```

Expected: lines like `Found: B01          → mastery='blank'  (B01-eval-harnesses.md)` for each module, ending with:

```
Wrote sidecar: /Users/unmukt/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum/_llmtutor-state.json
  Modules seeded: 20
```

(Count may vary if M0.5 counts as one entry; exact number is N of `.md` files with a `module_id` frontmatter key.)

- [ ] **Step 2.2 — Spot-check the sidecar**

```bash
python3 -c "
import json, pathlib
s = json.loads(pathlib.Path(
  '/Users/unmukt/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum/_llmtutor-state.json'
).read_text())
print('version:', s['version'])
print('modules:', sorted(s['modules'].keys()))
print('B01 mastery:', s['modules']['B01']['mastery'])
print('M03 mastery:', s['modules']['M03']['mastery'])
print('flashcards count:', len(s['flashcards']))
"
```

Expected:
```
version: 1
modules: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'M00', 'M0.5', 'M01', 'M02', ...]
B01 mastery: blank
M03 mastery: blank
flashcards count: 0
```

- [ ] **Step 2.3 — Verify idempotency (re-run produces the same output)**

```bash
python3 /Users/unmukt/llm-tutor/scripts/seed-sidecar.py \
  --curriculum-dir "/Users/unmukt/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum" \
  --dry-run 2>&1 | grep -c "Preserve:"
```

Expected: `20` (or the same count as Step 2.1's "Modules seeded") — every module already has a sidecar entry, so the script finds `existing_mastery = "blank"` and seeds again (blank→blank is fine). If any had earned progress (e.g. `"fuzzy"`), those lines would say `Preserve:` instead.

---

## Task 3 — Edit SKILL.md: "On invocation" step (read mastery from sidecar)

**Files:**
- Modify: `/Users/unmukt/.claude/skills/llm-deep-dive/SKILL.md`

The current "On invocation" block reads `_progress.md` to surface current state. After this edit it reads the sidecar instead, then renders a human-readable summary from it. `_progress.md` is retained as a mirror reference but no longer the source of truth.

The Edit tool is used with exact-string replacements. **No sed. No regex file mutations.**

- [ ] **Step 3.1 — Read SKILL.md to confirm the exact string to replace**

Read `/Users/unmukt/.claude/skills/llm-deep-dive/SKILL.md` lines 19–28 (the "On invocation" block). Confirm the following exact text is present:

```
## On invocation — first thing, every time

1. **Read** `~/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum/_progress.md`
2. **Surface** current state in one paragraph: last module completed, last session date, what's queued, what's flagged fuzzy
```

- [ ] **Step 3.2 — Apply Edit: replace the "On invocation" steps 1–2**

Using the Edit tool, replace exactly:

```
## On invocation — first thing, every time

1. **Read** `~/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum/_progress.md`
2. **Surface** current state in one paragraph: last module completed, last session date, what's queued, what's flagged fuzzy
```

With:

```
## On invocation — first thing, every time

> **State source of truth:** `_llmtutor-state.json` in `CURRICULUM_DIR` owns all mastery/SR/XP. `_progress.md` is a human-readable MIRROR — do not read it for mastery; read it only for the session-log prose and the queue narrative. The sidecar is always authoritative.

1. **Read** `~/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum/_llmtutor-state.json` (the sidecar). If it does not exist yet, run `python3 ~/llm-tutor/scripts/seed-sidecar.py` first to create it.
2. **Surface** current state in one paragraph derived from the sidecar: for each module, report `modules[id].mastery`; note modules with `mastery != "blank"`; report `streak.count`; report `sessionLog` last entry for "last session date"; flag any module whose `mcq.openDiagnosis` is non-null as needing follow-up.
```

- [ ] **Step 3.3 — Visually verify the edit was applied**

Read SKILL.md lines 19–35 and confirm the new "State source of truth" callout appears and the old `_progress.md` read instruction is gone.

---

## Task 4 — Edit SKILL.md: "Continuous baselining" rule (write mastery to sidecar)

The current hard rule §2 says: `Update baseline_state in _progress.md after every checkpoint.` After this edit, it writes to the sidecar and re-renders `_progress.md` from it.

- [ ] **Step 4.1 — Confirm the exact string for Rule §2**

Read SKILL.md around line 65–69. Confirm this exact block is present:

```
Update `baseline_state` in `_progress.md` after every checkpoint. The current baseline is canonical — never assume his level from prior sessions.
```

- [ ] **Step 4.2 — Apply Edit: update Rule §2 to write sidecar + mirror**

Using the Edit tool, replace exactly:

```
Update `baseline_state` in `_progress.md` after every checkpoint. The current baseline is canonical — never assume his level from prior sessions.
```

With:

```
After every checkpoint, **write the updated mastery to the sidecar** (`_llmtutor-state.json`) by:
1. Read the current sidecar JSON.
2. Set `modules[id].mastery = <new_level>` (one of `blank | fuzzy | solid | verified`).
3. Append to `modules[id].masteryHistory`: `{ "level": "<new_level>", "at": "<ISO-8601 UTC>", "via": "checkpoint-<1|2|3>" }`.
4. Write the full updated JSON back **atomically**: write to `_llmtutor-state.json.tmp` then rename to `_llmtutor-state.json`.
5. Then re-render the mastery columns in `_progress.md`'s two baseline tables (Track A and Track B) to match — this keeps the mirror readable, but the sidecar is the canonical record.

The current sidecar value is canonical — never assume his level from prior sessions.

> **Key groups the skill owns in the sidecar:** `modules[id].mastery`, `modules[id].masteryHistory`, `modules[id].stressTest`, `sessionLog`. Do not overwrite `modules[id].mcq`, `flashcards`, `xp`, or `streak` — those are owned by the app (S-STATE). Use a read-modify-write on the full object to preserve all keys.
```

- [ ] **Step 4.3 — Visually verify the edit**

Read SKILL.md around the baselining rule and confirm the 5-step write protocol appears with the key-group ownership note.

---

## Task 5 — Edit SKILL.md: close-phase "Update `_progress.md`" step

The session close phase (Phase 10) currently includes `Update _progress.md` as part of the closing action. After this edit, the close step writes to the sidecar first, then re-renders the mirror.

- [ ] **Step 5.1 — Confirm the exact string for Phase 10**

Read SKILL.md around line 47. Confirm this exact text is present:

```
| 10 | **Close: baseline #3 + stress-test + flashcard generation + operator line** | 5 min | Three-lens stress test (board / researcher / analyst). Generate 3-5 flashcards. Write one operator-grade line for `_operator_lines.md`. Update `_progress.md`. |
```

- [ ] **Step 5.2 — Apply Edit: update Phase 10 close action**

Using the Edit tool, replace exactly:

```
| 10 | **Close: baseline #3 + stress-test + flashcard generation + operator line** | 5 min | Three-lens stress test (board / researcher / analyst). Generate 3-5 flashcards. Write one operator-grade line for `_operator_lines.md`. Update `_progress.md`. |
```

With:

```
| 10 | **Close: baseline #3 + stress-test + flashcard generation + operator line** | 5 min | Three-lens stress test (board / researcher / analyst). Generate 3-5 flashcards. Write one operator-grade line for `_operator_lines.md`. Write final mastery + stressTest result to sidecar (per Rule §2 write protocol). Then re-render mastery columns in `_progress.md` mirror. |
```

- [ ] **Step 5.3 — Visually verify the edit**

Read the Phase 10 table row and confirm it references "sidecar" and "mirror."

---

## Task 6 — Edit SKILL.md: Storage section (demote `_progress.md` to mirror)

The current Storage section lists `_progress.md ← current state, baseline_state per module, queue` as the live store. Demote it to mirror status and add the sidecar entry.

- [ ] **Step 6.1 — Confirm the exact string in the Storage section**

Read SKILL.md around line 148. Confirm this exact text is present:

```
  _progress.md         ← current state, baseline_state per module, queue
```

- [ ] **Step 6.2 — Apply Edit: demote `_progress.md` and add sidecar**

Using the Edit tool, replace exactly:

```
  _progress.md         ← current state, baseline_state per module, queue
```

With:

```
  _llmtutor-state.json ← SOURCE OF TRUTH for mastery/SR/XP/MCQ (read/write — shared with app)
  _progress.md         ← MIRROR — human-readable view; re-rendered from sidecar at session close
```

- [ ] **Step 6.3 — Visually verify the edit**

Read SKILL.md's Storage section and confirm both lines appear, with the sidecar listed first and labeled SOURCE OF TRUTH.

---

## Task 7 — Verification: round-trip description + sanity checks

No code is run in this task — it is a structured verification of the plan's two-writer contract, confirmed by reading the modified files.

- [ ] **Step 7.1 — Verify SKILL.md has exactly 4 edited regions and no stale `_progress.md` mastery-write references**

```bash
grep -n "_progress.md" /Users/unmukt/.claude/skills/llm-deep-dive/SKILL.md
```

Expected: `_progress.md` still appears in non-mastery contexts (e.g. the Storage section MIRROR line, the `_design.md` / `_curriculum.md` / `_flashcards.md` lines, session-log prose references). It should NOT appear as the target for `baseline_state` writes or as the mastery source of truth. Manually check each hit and confirm.

- [ ] **Step 7.2 — Verify the sidecar exists and is valid JSON**

```bash
python3 -c "
import json, pathlib
path = pathlib.Path(
  '/Users/unmukt/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum/_llmtutor-state.json'
)
assert path.exists(), 'sidecar missing'
s = json.loads(path.read_text())
assert s['version'] == 1
assert isinstance(s['modules'], dict)
assert len(s['modules']) > 0
print('PASS: sidecar valid, modules:', len(s['modules']))
"
```

Expected: `PASS: sidecar valid, modules: 20` (or the actual count from Step 2.1).

- [ ] **Step 7.3 — Round-trip description (human-verified, no code)**

Confirm the following round-trip works by reading the edited SKILL.md and the sidecar schema in `00-shared-model.md` §5:

1. **Skill writes mastery after a session:** Claude reads `_llmtutor-state.json`, sets `modules["B01"].mastery = "fuzzy"`, appends to `masteryHistory`, writes back atomically. `_progress.md` B01 row is then updated to show `fuzzy` in the "Current level" column.

2. **App reads the skill's write:** Next.js S-STATE calls `StateStore.read()` which loads `_llmtutor-state.json` → `modules["B01"].mastery` is `"fuzzy"` → the React Flow map node for B01 renders in the "fuzzy" color. No extra sync step needed.

3. **App writes MCQ data, skill is unaffected:** the app writes `modules["B01"].mcq.matrix` after a quiz session. The skill's next invocation reads the sidecar → sees `mastery = "fuzzy"` (which the skill set) + MCQ matrix (which the app set) → both present in the same object. No conflict.

4. **Sidecar does not exist yet (bootstrap):** the skill's "On invocation" step 1 checks for the file; if absent, it instructs running `seed-sidecar.py` before proceeding. The app's `StateStore.read()` (per `00-shared-model.md` §5) also creates a default state if missing — so both paths handle cold start.

- [ ] **Step 7.4 — Confirm `_progress.md` is still a valid human-readable file (not corrupted)**

Read the first 15 lines of `_progress.md` and confirm the YAML frontmatter and heading are intact. The seed script does not touch `_progress.md`; the SKILL.md edits only change *when* it gets updated (at session close, rendered from sidecar), not its format.

---

## Task 8 — Commit

- [ ] **Step 8.1 — Stage and commit the seed script**

```bash
cd /Users/unmukt/llm-tutor && git add scripts/seed-sidecar.py docs/plans/plan-04-skill-sidecar-migration.md
git commit -m "$(cat <<'EOF'
feat(state): add sidecar seed script + plan-04 migration plan

seed-sidecar.py does a one-time idempotent migration from module
frontmatter baseline_state.current_level → _llmtutor-state.json,
establishing the single-writer sidecar contract between the skill
and the app. plan-04 documents the full SKILL.md edit sequence.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8.2 — Confirm git status is clean**

```bash
cd /Users/unmukt/llm-tutor && git status
```

Expected: `nothing to commit, working tree clean`

Note: `SKILL.md` lives in `~/.claude/skills/` which is outside the `llm-tutor` repo. The SKILL.md edits are not committed to this repo — they take effect immediately for the Claude agent. If the skills directory is tracked by a separate git repo, commit it there separately.

---

## Task 9 — Edit SKILL.md: First-session ritual (M00 bootstrap path)

The "First-session ritual" section currently checks for `_progress.md` existence as the bootstrap gate and writes the front-load order to `_progress.md`. After this edit, the bootstrap gate checks for the sidecar, and the write goes to the sidecar (+ mirror).

- [ ] **Step 9.1 — Confirm the exact strings in the First-session ritual**

Read SKILL.md around line 218–226. Confirm both of these exact strings are present:

String A:
```
When invoked for the first time (no `_progress.md` exists or it's empty):
```

String B:
```
5. At the end: write personalized front-load order to `_progress.md`, mark M00 complete
```

- [ ] **Step 9.2 — Apply Edit: update the bootstrap gate (String A)**

Using the Edit tool, replace exactly:

```
When invoked for the first time (no `_progress.md` exists or it's empty):
```

With:

```
When invoked for the first time (sidecar `_llmtutor-state.json` does not exist or contains no non-blank modules — check `modules` values):
```

- [ ] **Step 9.3 — Apply Edit: update the front-load write (String B)**

Using the Edit tool, replace exactly:

```
5. At the end: write personalized front-load order to `_progress.md`, mark M00 complete
```

With:

```
5. At the end: write personalized front-load order to the sidecar — set `modules["M00"].mastery = "fuzzy"` and append a `masteryHistory` entry with `via: "M00-baseline"`. Then re-render the queue and mastery columns in `_progress.md` mirror. If the sidecar does not exist yet, run `python3 ~/llm-tutor/scripts/seed-sidecar.py` first.
```

- [ ] **Step 9.4 — Visually verify the edits**

Read SKILL.md's First-session ritual section and confirm the sidecar is now the bootstrap target and write destination.

---

## Notes on the two-writer contract

**Why last-writer-wins is safe here:**

The skill runs interactively (human triggers it; Claude processes synchronously; session ends before the app could be running a quiz simultaneously). The app runs when Unmukt opens the browser. In normal use these are never concurrent. If they were:

- **Disjoint keys** mean a merge conflict is structurally impossible: the skill writes `mastery/masteryHistory/stressTest/sessionLog`; the app writes `mcq/flashcards/xp/streak`. A full read-modify-write that only touches own keys = safe last-writer semantics.
- **Atomic rename** (`tmp → final`) means neither writer can read a partial write.
- **No optimistic locking needed for MVP** (single user, non-concurrent). If concurrency becomes real (e.g. a background SR timer), add a `last_modified` timestamp and a merge step in S-STATE — but that is explicitly out of scope for plan-04.
