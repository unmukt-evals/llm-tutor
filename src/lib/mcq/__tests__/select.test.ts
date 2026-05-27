import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { selectAssessment } from '../select';
import { FileMCQRepository } from '../repository';
import { emptyMatrix } from '../matrix';
import type { MCQPool, MCQQuestion, ModuleState } from '../../types';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

function freshState(): ModuleState {
  return {
    mastery: 'blank',
    masteryHistory: [],
    mcq: {
      matrix: emptyMatrix(),
      distractorLog: [],
      dimensionProfile: { topic: 'untested', logic: 'untested', example: 'untested', extension: 'untested' },
      recentCorrect: [],
    },
    stressTest: {},
  };
}

// deterministic, repeatable PRNG so we can assert across many seeds
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

async function loadPool(): Promise<MCQPool> {
  const repo = new FileMCQRepository(FIXTURE_DIR, (id) => `${id}-fixture.json`);
  const pool = await repo.loadPool('B99');
  if (!pool) throw new Error('fixture missing');
  return pool;
}

describe('selectAssessment guarantees', () => {
  it('returns exactly spec.count questions', async () => {
    const pool = await loadPool();
    const sel = selectAssessment(pool, freshState(), { moduleId: 'B99', count: 6 }, lcg(1));
    expect(sel).toHaveLength(6);
  });

  it('ALWAYS spans all 3 difficulties and >=3 distinct dimensions (200 seeds)', async () => {
    const pool = await loadPool();
    for (let seed = 1; seed <= 200; seed++) {
      const sel = selectAssessment(pool, freshState(), { moduleId: 'B99', count: 6 }, lcg(seed));
      const diffs = new Set(sel.map((q) => q.difficulty));
      const dims = new Set(sel.map((q) => q.dimension));
      expect(diffs.has('easy')).toBe(true);
      expect(diffs.has('medium')).toBe(true);
      expect(diffs.has('hard')).toBe(true);
      expect(dims.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('never repeats a question within one assessment (50 seeds)', async () => {
    const pool = await loadPool();
    for (let seed = 1; seed <= 50; seed++) {
      const sel = selectAssessment(pool, freshState(), { moduleId: 'B99', count: 6 }, lcg(seed));
      expect(new Set(sel.map((q) => q.id)).size).toBe(sel.length);
    }
  });

  it('excludes recently-correct questions (anti-farm) when guarantees still satisfiable', async () => {
    const pool = await loadPool();
    const state = freshState();
    const sel = selectAssessment(
      pool,
      state,
      { moduleId: 'B99', count: 6, excludeIds: ['B99-e-topic'] },
      lcg(3),
    );
    expect(sel.map((q) => q.id)).not.toContain('B99-e-topic');
    expect(new Set(sel.map((q) => q.difficulty))).toEqual(new Set(['easy', 'medium', 'hard']));
  });

  it('honors a large excludeIds set as long as guarantees remain satisfiable (100 seeds)', async () => {
    const pool = await loadPool();
    // Exclude one whole dimension (topic). The remaining 3 dims x 3 diffs still satisfy guarantees.
    const excludeIds = pool.questions.filter((q) => q.dimension === 'topic').map((q) => q.id);
    for (let seed = 1; seed <= 100; seed++) {
      const sel = selectAssessment(pool, freshState(), { moduleId: 'B99', count: 6, excludeIds }, lcg(seed));
      for (const ex of excludeIds) expect(sel.map((q) => q.id)).not.toContain(ex);
      const diffs = new Set(sel.map((q) => q.difficulty));
      expect(diffs).toEqual(new Set(['easy', 'medium', 'hard']));
    }
  });

  it('weights extra slots toward weak/untested dimensions', async () => {
    const pool = await loadPool();
    const state = freshState();
    state.mcq.dimensionProfile = { topic: 'solid', logic: 'solid', example: 'solid', extension: 'weak' };
    let extensionHits = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const sel = selectAssessment(pool, state, { moduleId: 'B99', count: 6 }, lcg(seed));
      if (sel.some((q) => q.dimension === 'extension')) extensionHits++;
    }
    expect(extensionHits).toBeGreaterThan(90);
  });

  it('is deterministic for a fixed rng seed', async () => {
    const pool = await loadPool();
    const a = selectAssessment(pool, freshState(), { moduleId: 'B99', count: 6 }, lcg(42));
    const b = selectAssessment(pool, freshState(), { moduleId: 'B99', count: 6 }, lcg(42));
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
  });
});

describe('selectAssessment graceful degradation (tiny / constrained pools)', () => {
  function tinyPool(questions: MCQQuestion[]): MCQPool {
    return { moduleId: 'TINY', questions };
  }
  function q(id: string, difficulty: MCQQuestion['difficulty'], dimension: MCQQuestion['dimension']): MCQQuestion {
    return {
      id,
      moduleId: 'TINY',
      difficulty,
      dimension,
      stem: '',
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
      distractorMisconception: { '1': '', '2': '', '3': '' },
      explanation: '',
    };
  }

  it('returns what it can without throwing when the pool is smaller than count', async () => {
    const pool = tinyPool([q('a', 'easy', 'topic'), q('b', 'hard', 'logic')]);
    const sel = selectAssessment(pool, freshState(), { moduleId: 'TINY', count: 6 }, lcg(1));
    expect(sel).toHaveLength(2);
    expect(new Set(sel.map((s) => s.id)).size).toBe(2);
  });

  it('returns an empty array (no throw) on an empty pool', async () => {
    const pool = tinyPool([]);
    expect(() => selectAssessment(pool, freshState(), { moduleId: 'TINY', count: 6 }, lcg(1))).not.toThrow();
    expect(selectAssessment(pool, freshState(), { moduleId: 'TINY', count: 6 }, lcg(1))).toEqual([]);
  });

  it('falls back to the full pool rather than failing difficulty guarantee when excludes are too aggressive', async () => {
    const pool = await loadPool();
    // Exclude EVERY hard question — excluding them would make the >=1 hard guarantee impossible.
    // Per the plan priority, the difficulty guarantee wins over the exclude.
    const excludeIds = pool.questions.filter((p) => p.difficulty === 'hard').map((p) => p.id);
    const sel = selectAssessment(pool, freshState(), { moduleId: 'B99', count: 6, excludeIds }, lcg(7));
    expect(sel.some((s) => s.difficulty === 'hard')).toBe(true);
  });
});
