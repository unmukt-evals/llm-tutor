-- 003_question_remediation.sql
-- Feature 2: persist per-question remediation (deepDive + moduleRefs + seeAlso)
-- through the SQLite cache so /assess (which reads via cms.getPool, not loadPool)
-- surfaces it. Stored as a JSON blob; NULL when a question has no remediation.
ALTER TABLE mcq_questions ADD COLUMN remediation_json TEXT;
