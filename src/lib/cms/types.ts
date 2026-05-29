// CMS-domain types. The READ API of the CMS index returns the existing UI
// shapes from `@/lib/types` so Phase 2 can swap learner call sites without
// changing any component. The shapes below are SQLite-row mirrors used inside
// the indexer / read API only — they are NOT the UI types in `@/lib/types`.

import type {
  Curriculum,
  Module,
  MCQPool,
  ModuleState,
  TutorState,
  Source,
} from '@/lib/types';
import type { Flashcard } from '@/lib/cards/parse-flashcards';

/** Kind of content entity the indexer knows how to refresh. */
export type EntityKind = 'module' | 'pool' | 'flashcards' | 'source' | 'state';

/**
 * Tracking row for any indexed file. `content_hash` is the sha256 of the file
 * bytes at index time; `mtime_ms` is the file's mtime in ms epoch at index
 * time; `indexed_at` is the wall-clock ms epoch when this tracking row was
 * written. Updated together inside one SQL transaction with the entity rows.
 */
export interface IndexRow {
  kind: EntityKind;
  entity_id: string;   // module id, pool id, '_flashcards', source id, '__state__'
  content_hash: string;
  mtime_ms: number;
  indexed_at: number;
}

/** Internal storage shape for a module row. The full `Module` is reconstructed
 *  by the read API by joining child tables (passes, visuals, drills, etc.). */
export interface StoredModule {
  id: string;
  track: string;
  name: string;
  prerequisites: string[];   // JSON
  primary_sources: string[]; // JSON
  why_this_matters: string;
  anchors: string[];         // JSON
  lab_spec: string | null;
  sources: string[];         // JSON (the rendered `## Sources` lines)
  content_hash: string;
  updated_at: number;
}

/** Internal storage shape for an MCQ pool row (denormalized questions live in
 *  `mcq_questions`). */
export interface StoredPool {
  module_id: string;
  content_hash: string;
  updated_at: number;
}

/** Internal storage shape for a flashcard row. */
export interface StoredFlashcard extends Flashcard {
  content_hash: string;      // hash of the pre-split source line
  updated_at: number;
}

/** On-disk shape of `_sources.json`. */
export interface SourcesDoc {
  version: 1;
  sources: Source[];
}

/** SQLite row mirrors Source 1:1 for Phase 4. */
export type StoredSource = Source;

/** Mirror of the sidecar's per-module state slice. The full `ModuleState`
 *  payload is JSON-encoded so reads can rebuild the in-memory shape verbatim. */
export interface StoredModuleState {
  module_id: string;
  state_json: string;
  updated_at: number;
}

/** App-singleton state (xp, streak, version, sessionLog as JSON). */
export interface StoredAppState {
  version: number;
  xp_total: number;
  xp_this_week: number;
  streak_count: number;
  streak_last_active: string;
  streak_freeze_tokens: number;
  session_log: TutorState['sessionLog']; // JSON
  updated_at: number;
}

/** Audit-log row (Phase 3+ writes here; Phase 1 only creates the table). */
export interface Revision {
  id: number;
  kind: EntityKind;
  entity_id: string;
  payload_json: string;
  at: number;
}

// ── Read-API return shapes (UI types, re-exported for clarity) ──────────────
export type { Curriculum, Module, MCQPool, ModuleState, TutorState, Flashcard };

/** Flat row the read API yields for the rendered "Sources" surface in Phase 2.
 *  Phase 1 returns an empty array; Phase 4 populates from `_sources.json`. */
export interface SourceRowsAsRendered {
  id: string;
  title: string;
  url: string | null;
  summary: string | null;
}
