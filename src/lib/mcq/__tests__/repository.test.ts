import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileMCQRepository } from '@/lib/mcq/repository';
import { validatePool, getMcqRepository } from '@/lib/mcq';
import * as bad from './fixtures/bad-pools';
import { B99_POOL } from './fixtures/pool';

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url)) + '/fixtures';
const fixtureNamer = (id: string) => `${id}-fixture.json`;

describe('FileMCQRepository.loadPool', () => {
  it('loads a valid pool and returns a typed MCQPool', async () => {
    // fixtures dir is treated as a "curriculum/mcq" dir; file is B99-fixture.json
    const repo = new FileMCQRepository(FIXTURE_DIR, fixtureNamer);
    const pool = await repo.loadPool('B99');
    expect(pool).not.toBeNull();
    expect(pool!.moduleId).toBe('B99');
    expect(pool!.questions).toHaveLength(12);
    expect(pool!.questions[0].correctIndex).toBe(0);
    // every question carries the pool moduleId after normalization
    expect(pool!.questions.every((q) => q.moduleId === 'B99')).toBe(true);
  });

  it('returns null when the pool file does not exist', async () => {
    const repo = new FileMCQRepository(FIXTURE_DIR, fixtureNamer);
    const pool = await repo.loadPool('NOPE');
    expect(pool).toBeNull();
  });

  it('preserves generatedAt + sourceHash metadata through load', async () => {
    const repo = new FileMCQRepository(FIXTURE_DIR, fixtureNamer);
    const pool = await repo.loadPool('B99');
    expect(pool!.generatedAt).toBe('2026-06-11T00:00:00.000Z');
    expect(pool!.sourceHash).toBe('deadbeefcafef00d');
  });

  it('throws a clear error when the file exists but is invalid', async () => {
    // bad-pool.json is written alongside the fixtures as a real (malformed) file
    const repo = new FileMCQRepository(FIXTURE_DIR, () => 'bad-pool.json');
    await expect(repo.loadPool('whatever')).rejects.toThrow(/exactly 4 options/i);
  });

  it('preserves question remediation through load', async () => {
    const repo = new FileMCQRepository(FIXTURE_DIR, fixtureNamer);
    const pool = await repo.loadPool('B99');
    const q = pool!.questions.find((x) => x.remediation);
    expect(q, 'fixture should carry a question with remediation').toBeDefined();
    expect(q!.remediation!.deepDive.length).toBeGreaterThan(0);
    expect(q!.remediation!.moduleRefs?.[0]?.pass).toBeTruthy();
  });
});

describe('getMcqRepository factory', () => {
  it('resolves pool files under <curriculumDir>/mcq/<moduleId>.json', async () => {
    // FIXTURE_DIR ends in /fixtures; treat its parent as the curriculum dir so
    // the factory looks in <parent>/mcq — which does not exist → null (no throw).
    const curriculumDir = path.dirname(FIXTURE_DIR);
    const repo = getMcqRepository(curriculumDir);
    expect(await repo.loadPool('B99')).toBeNull();
  });
});

describe('validatePool', () => {
  it('accepts the valid fixture', () => {
    expect(() => validatePool(B99_POOL)).not.toThrow();
  });

  it('accepts optional generatedAt + sourceHash when they are strings', () => {
    const stamped = { ...B99_POOL, generatedAt: '2026-06-11T00:00:00.000Z', sourceHash: 'abc123' };
    expect(() => validatePool(stamped)).not.toThrow();
    expect(validatePool(stamped).generatedAt).toBe('2026-06-11T00:00:00.000Z');
  });

  it('rejects a non-string generatedAt when present', () => {
    expect(() => validatePool({ ...B99_POOL, generatedAt: 123 } as unknown)).toThrow(/generatedAt/i);
  });

  it('rejects a non-string sourceHash when present', () => {
    expect(() => validatePool({ ...B99_POOL, sourceHash: {} } as unknown)).toThrow(/sourceHash/i);
  });

  const withRem = (rem: unknown) => ({
    ...B99_POOL,
    questions: [{ ...B99_POOL.questions[0], remediation: rem }, ...B99_POOL.questions.slice(1)],
  });
  it('accepts a valid remediation block', () => {
    expect(() =>
      validatePool(
        withRem({
          deepDive: 'A deeper explanation of the concept.',
          moduleRefs: [{ pass: 'engineer', anchor: 'dilution', label: 'Re-learn: dilution' }],
          seeAlso: ['M02 embeddings'],
        }),
      ),
    ).not.toThrow();
  });
  it('rejects an empty remediation.deepDive', () => {
    expect(() => validatePool(withRem({ deepDive: '' }))).toThrow(/deepDive/i);
  });
  it('rejects a remediation moduleRef with an invalid pass', () => {
    expect(() =>
      validatePool(withRem({ deepDive: 'x', moduleRefs: [{ pass: 'wizard', label: 'go' }] })),
    ).toThrow(/pass/i);
  });
  it('rejects a remediation moduleRef missing a label', () => {
    expect(() =>
      validatePool(withRem({ deepDive: 'x', moduleRefs: [{ pass: 'engineer' }] })),
    ).toThrow(/label/i);
  });
  it('rejects non-array remediation.seeAlso', () => {
    expect(() => validatePool(withRem({ deepDive: 'x', seeAlso: 'nope' }))).toThrow(/seeAlso/i);
  });

  it.each([
    ['threeOptions', bad.threeOptions, /exactly 4 options/i],
    ['emptyOptionsArray', bad.emptyOptionsArray, /exactly 4 options/i],
    ['correctOutOfRange', bad.correctOutOfRange, /correctIndex/i],
    ['correctNegative', bad.correctNegative, /correctIndex/i],
    ['correctNotInteger', bad.correctNotInteger, /correctIndex/i],
    ['badDifficulty', bad.badDifficulty, /difficulty/i],
    ['badDimension', bad.badDimension, /dimension/i],
    ['distractorKeyOnCorrect', bad.distractorKeyOnCorrect, /distractorMisconception/i],
    ['distractorKeyMissing', bad.distractorKeyMissing, /distractorMisconception/i],
    ['distractorKeyOutOfRange', bad.distractorKeyOutOfRange, /distractorMisconception/i],
    ['missingStem', bad.missingStem, /stem/i],
    ['missingExplanation', bad.missingExplanation, /explanation/i],
    ['notAnArray', bad.notAnArray, /questions must be an array/i],
    ['missingModuleId', bad.missingModuleId, /moduleId must be a string/i],
  ])('rejects %s', (_name, pool, re) => {
    expect(() => validatePool(pool as unknown)).toThrow(re);
  });
});
