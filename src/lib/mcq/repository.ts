import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  MCQPool,
  MCQQuestion,
  MCQRepository,
  Difficulty,
  Dimension,
  DepthPass,
} from '@/lib/types';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];
const DEPTH_PASSES: DepthPass[] = ['tenYearOld', 'engineer', 'operator'];

/**
 * Pure validator. Throws an Error with a human-readable message if the pool is
 * malformed; returns the typed MCQPool on success. No I/O — safe to unit-test
 * directly against literals.
 *
 * Per-question checks (plan-03 Task 2 / 00-shared-model §3–§4):
 *   - id / moduleId are strings
 *   - difficulty ∈ {easy,medium,hard}; dimension ∈ {topic,logic,example,extension}
 *   - exactly 4 options
 *   - correctIndex is an integer in 0..3
 *   - distractorMisconception has an entry for EVERY wrong-option index, and its
 *     keys are EXACTLY those wrong indices (no key on the correct index, none out of range)
 *   - stem / explanation present (non-empty strings)
 */
export function validatePool(pool: unknown): MCQPool {
  if (!pool || typeof pool !== 'object') throw new Error('pool must be an object');
  const p = pool as Record<string, unknown>;
  if (typeof p.moduleId !== 'string') throw new Error('pool moduleId must be a string');
  if (!Array.isArray(p.questions)) throw new Error('pool questions must be an array');
  if (p.generatedAt !== undefined && typeof p.generatedAt !== 'string') {
    throw new Error('pool generatedAt must be a string when present');
  }
  if (p.sourceHash !== undefined && typeof p.sourceHash !== 'string') {
    throw new Error('pool sourceHash must be a string when present');
  }

  for (const raw of p.questions as unknown[]) {
    if (!raw || typeof raw !== 'object') throw new Error('each question must be an object');
    const q = raw as Record<string, unknown>;

    if (typeof q.id !== 'string') throw new Error('question id must be a string');
    const id = q.id;

    if (typeof q.moduleId !== 'string') {
      throw new Error(`question ${id} moduleId must be a string`);
    }
    if (!DIFFICULTIES.includes(q.difficulty as Difficulty)) {
      throw new Error(`question ${id} has invalid difficulty "${String(q.difficulty)}"`);
    }
    if (!DIMENSIONS.includes(q.dimension as Dimension)) {
      throw new Error(`question ${id} has invalid dimension "${String(q.dimension)}"`);
    }
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      throw new Error(`question ${id} must have exactly 4 options`);
    }
    if (
      typeof q.correctIndex !== 'number' ||
      !Number.isInteger(q.correctIndex) ||
      q.correctIndex < 0 ||
      q.correctIndex > 3
    ) {
      throw new Error(`question ${id} has correctIndex out of range (must be an integer 0..3)`);
    }
    if (typeof q.stem !== 'string' || q.stem.length === 0) {
      throw new Error(`question ${id} is missing a stem`);
    }
    if (typeof q.explanation !== 'string' || q.explanation.length === 0) {
      throw new Error(`question ${id} is missing an explanation`);
    }

    const dm = q.distractorMisconception;
    if (!dm || typeof dm !== 'object' || Array.isArray(dm)) {
      throw new Error(`question ${id} is missing distractorMisconception`);
    }
    const expected = [0, 1, 2, 3]
      .filter((i) => i !== q.correctIndex)
      .map(String)
      .sort();
    const actual = Object.keys(dm as Record<string, unknown>).sort();
    if (expected.length !== actual.length || expected.some((k, i) => k !== actual[i])) {
      throw new Error(
        `question ${id} distractorMisconception keys must be exactly the wrong-option indices [${expected.join(
          ',',
        )}]`,
      );
    }

    // Feature 2: optional remediation block. Back-compat — absent is fine.
    const rem = q.remediation;
    if (rem !== undefined) {
      if (!rem || typeof rem !== 'object' || Array.isArray(rem)) {
        throw new Error(`question ${id} remediation must be an object`);
      }
      const r = rem as Record<string, unknown>;
      if (typeof r.deepDive !== 'string' || r.deepDive.length === 0) {
        throw new Error(`question ${id} remediation.deepDive must be a non-empty string`);
      }
      if (r.moduleRefs !== undefined) {
        if (!Array.isArray(r.moduleRefs)) {
          throw new Error(`question ${id} remediation.moduleRefs must be an array`);
        }
        for (const ref of r.moduleRefs) {
          if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
            throw new Error(`question ${id} remediation.moduleRefs[] entries must be objects`);
          }
          const rr = ref as Record<string, unknown>;
          if (!DEPTH_PASSES.includes(rr.pass as DepthPass)) {
            throw new Error(
              `question ${id} remediation.moduleRefs[].pass must be one of ${DEPTH_PASSES.join('|')}`,
            );
          }
          if (typeof rr.label !== 'string' || rr.label.length === 0) {
            throw new Error(`question ${id} remediation.moduleRefs[].label must be a non-empty string`);
          }
          if (rr.anchor !== undefined && typeof rr.anchor !== 'string') {
            throw new Error(`question ${id} remediation.moduleRefs[].anchor must be a string`);
          }
        }
      }
      if (r.seeAlso !== undefined) {
        if (!Array.isArray(r.seeAlso) || !r.seeAlso.every((s) => typeof s === 'string')) {
          throw new Error(`question ${id} remediation.seeAlso must be a string[]`);
        }
      }
    }
  }

  return pool as MCQPool;
}

/** Maps a moduleId to its pool filename. Default: "<id>.json" (matches <mcqDir>/<id>.json). */
export type FileNamer = (moduleId: string) => string;

/**
 * Filesystem-backed MCQRepository. Reads `<mcqDir>/<nameFor(moduleId)>`:
 *   - missing file (ENOENT) → null (a module may have no pool yet, not an error)
 *   - present but invalid → throws a clear validation error
 *   - valid → returns the validated, moduleId-normalized MCQPool
 */
export class FileMCQRepository implements MCQRepository {
  constructor(
    private readonly mcqDir: string,
    private readonly nameFor: FileNamer = (id) => `${id}.json`,
  ) {}

  async loadPool(moduleId: string): Promise<MCQPool | null> {
    const file = path.join(this.mcqDir, this.nameFor(moduleId));
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    const parsed: unknown = JSON.parse(raw);
    const validated = validatePool(parsed);
    // Normalize: trust the pool's moduleId on every question.
    const questions = validated.questions.map(
      (q): MCQQuestion => ({ ...q, moduleId: validated.moduleId }),
    );
    return {
      moduleId: validated.moduleId,
      questions,
      ...(validated.generatedAt !== undefined ? { generatedAt: validated.generatedAt } : {}),
      ...(validated.sourceHash !== undefined ? { sourceHash: validated.sourceHash } : {}),
    };
  }
}
