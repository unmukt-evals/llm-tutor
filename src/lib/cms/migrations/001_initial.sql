-- CMS Phase 1 — initial schema (declarative).
-- Source-of-truth stays on disk (CURRICULUM_DIR); this DB is a cache that the
-- indexer rebuilds. Every content entity carries content_hash + updated_at.
-- Runs inside a single transaction (driven by db.ts) so a syntax error here
-- rolls the schema back to "fresh".

-- Idempotent: the migration runner pre-creates this; we (re)assert it so the
-- file is self-contained when applied to an empty DB by other tools.
CREATE TABLE IF NOT EXISTS _schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- ── Modules + child rows ────────────────────────────────────────────────────
CREATE TABLE modules (
  id                TEXT PRIMARY KEY,
  track             TEXT NOT NULL,
  name              TEXT NOT NULL,
  prerequisites_json TEXT NOT NULL DEFAULT '[]',
  primary_sources_json TEXT NOT NULL DEFAULT '[]',
  why_this_matters  TEXT NOT NULL DEFAULT '',
  anchors_json      TEXT NOT NULL DEFAULT '[]',
  lab_spec          TEXT,
  sources_json      TEXT NOT NULL DEFAULT '[]',
  content_hash      TEXT NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_modules_track ON modules(track);

CREATE TABLE module_passes (
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL CHECK (kind IN ('tenYearOld','engineer','operator')),
  body_md   TEXT NOT NULL,
  PRIMARY KEY (module_id, kind)
);

CREATE TABLE module_visuals (
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  ord       INTEGER NOT NULL,
  type      TEXT NOT NULL,
  title     TEXT,
  data_json TEXT NOT NULL,
  PRIMARY KEY (module_id, ord)
);
CREATE INDEX idx_module_visuals_module_ord ON module_visuals(module_id, ord);

CREATE TABLE module_diagrams (
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  ord       INTEGER NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('mermaid','ascii','code')),
  body      TEXT NOT NULL,
  PRIMARY KEY (module_id, ord)
);
CREATE INDEX idx_module_diagrams_module_ord ON module_diagrams(module_id, ord);

CREATE TABLE module_drills (
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  ord       INTEGER NOT NULL,
  scenario  TEXT NOT NULL,
  dc1       TEXT,
  dc2       TEXT,
  PRIMARY KEY (module_id, ord)
);
CREATE INDEX idx_module_drills_module_ord ON module_drills(module_id, ord);

CREATE TABLE module_stress_tests (
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  ord       INTEGER NOT NULL,
  lens      TEXT NOT NULL CHECK (lens IN ('board','researcher','analyst')),
  question  TEXT NOT NULL,
  PRIMARY KEY (module_id, ord)
);

CREATE TABLE module_flashcard_seeds (
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  ord       INTEGER NOT NULL,
  seed      TEXT NOT NULL,
  PRIMARY KEY (module_id, ord)
);

-- ── MCQ pools + questions ───────────────────────────────────────────────────
-- No FK to modules: a pool may be (re-)indexed before its module file is
-- (re-)indexed (the indexer iterates each kind independently and the cache
-- is a join over string moduleIds, not an enforced graph).
CREATE TABLE mcq_pools (
  module_id    TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE mcq_questions (
  id                            TEXT PRIMARY KEY,
  module_id                     TEXT NOT NULL REFERENCES mcq_pools(module_id) ON DELETE CASCADE,
  ord                           INTEGER NOT NULL DEFAULT 0,
  difficulty                    TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  dimension                     TEXT NOT NULL CHECK (dimension IN ('topic','logic','example','extension')),
  stem                          TEXT NOT NULL,
  options_json                  TEXT NOT NULL,
  correct_index                 INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  distractor_misconceptions_json TEXT NOT NULL DEFAULT '{}',
  explanation                   TEXT NOT NULL,
  source_ref                    TEXT
);
CREATE INDEX idx_mcq_questions_module ON mcq_questions(module_id, ord);

-- ── Flashcards + per-card SR state ──────────────────────────────────────────
CREATE TABLE flashcards (
  id           TEXT PRIMARY KEY,
  module_id    TEXT,
  ord          INTEGER NOT NULL DEFAULT 0,
  last_tested  TEXT,
  front        TEXT NOT NULL,
  back         TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_flashcards_module ON flashcards(module_id);
CREATE INDEX idx_flashcards_ord ON flashcards(ord);

-- No FK to flashcards: indexState() can run before flashcards have been
-- re-indexed, and the sidecar is the source of truth for SR state regardless
-- of whether a card row currently exists in the cache.
CREATE TABLE flashcard_state (
  card_id       TEXT PRIMARY KEY,
  last_tested   TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  ease          TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ── Sources (Phase 4 will populate; Phase 1 leaves empty) ───────────────────
CREATE TABLE sources (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT,
  fetched_at   INTEGER,
  raw_text     TEXT NOT NULL DEFAULT '',
  summary      TEXT,
  content_hash TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE module_sources (
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (module_id, source_id)
);

-- ── Sidecar-state mirrors (rewritten by indexState()) ───────────────────────
CREATE TABLE module_state (
  module_id            TEXT PRIMARY KEY,
  mastery              TEXT NOT NULL,
  mastery_history_json TEXT NOT NULL DEFAULT '[]',
  mcq_state_json       TEXT NOT NULL DEFAULT '{}',
  stress_test_json     TEXT NOT NULL DEFAULT '{}',
  updated_at           INTEGER NOT NULL
);

CREATE TABLE app_state (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  version              INTEGER NOT NULL,
  xp_total             INTEGER NOT NULL DEFAULT 0,
  xp_this_week         INTEGER NOT NULL DEFAULT 0,
  streak_count         INTEGER NOT NULL DEFAULT 0,
  streak_last_active   TEXT NOT NULL DEFAULT '',
  streak_freeze_tokens INTEGER NOT NULL DEFAULT 0,
  session_log_json     TEXT NOT NULL DEFAULT '[]',
  updated_at           INTEGER NOT NULL
);

-- ── Indexer bookkeeping + audit log ─────────────────────────────────────────
CREATE TABLE index_rows (
  kind         TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  mtime_ms     INTEGER NOT NULL,
  indexed_at   INTEGER NOT NULL,
  PRIMARY KEY (kind, entity_id)
);

CREATE TABLE revisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  at           INTEGER NOT NULL
);
CREATE INDEX idx_revisions_kind_entity_at ON revisions(kind, entity_id, at);
