-- CMS Phase 4 — add rich Source columns + stale_at flag on module_sources.
--
-- module_sources gains stale_at (nullable) for the Phase 5/6 "source updated
-- → flag citing modules" workflow. Phase 4 does not write this column.
--
-- sources gains the fields that StoredSource = Source requires but the Phase 1
-- stub omitted: author, cluster, thesis, mechanism, quotes_json, grounds_json.
-- quotes/grounds are serialised as JSON arrays matching Source.quotes/grounds.

ALTER TABLE module_sources ADD COLUMN stale_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_module_sources_stale ON module_sources(stale_at);

ALTER TABLE sources ADD COLUMN author TEXT;
ALTER TABLE sources ADD COLUMN cluster TEXT;
ALTER TABLE sources ADD COLUMN thesis TEXT;
ALTER TABLE sources ADD COLUMN mechanism TEXT;
ALTER TABLE sources ADD COLUMN quotes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sources ADD COLUMN grounds_json TEXT NOT NULL DEFAULT '[]';
