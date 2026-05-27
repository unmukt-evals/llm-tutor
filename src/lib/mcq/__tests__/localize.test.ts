import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { updateMatrix, emptyMatrix } from '../matrix';
import { detectInconsistency } from '../inconsistency';
import { localize, routeRemediation } from '../localize';
import { FileMCQRepository } from '../repository';
import type { MCQQuestion, MCQAnswer, ChosenDistractor, MCQPool, PerformanceMatrix } from '../../types';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
async function loadPool(): Promise<MCQPool> {
  const repo = new FileMCQRepository(FIXTURE_DIR, (id) => `${id}-fixture.json`);
  const p = await repo.loadPool('B99');
  if (!p) throw new Error('fixture missing');
  return p;
}
const ans = (q: MCQQuestion, chosen: number): MCQAnswer => ({ questionId: q.id, chosenIndex: chosen, correct: chosen === q.correctIndex, at: 't' });

describe('routeRemediation', () => {
  it('maps dimensions to content layers per build-spec §3.1', () => {
    expect(routeRemediation('topic')).toBe('tenYearOld');
    expect(routeRemediation('logic')).toBe('engineer');
    expect(routeRemediation('example')).toBe('lab');
    expect(routeRemediation('extension')).toBe('drill');
  });
});

describe('localize — EXACT user scenario', () => {
  it('easy correct + some-medium-correct + some-medium-wrong clustered in extension → inconsistency → localizes extension → routes to drill', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;

    let m: PerformanceMatrix = emptyMatrix();
    const log: ChosenDistractor[] = [];

    // easy: all correct
    for (const id of ['B99-e-topic', 'B99-e-logic', 'B99-e-example', 'B99-e-ext']) {
      m = updateMatrix(m, ans(byId(id), byId(id).correctIndex), byId(id));
    }
    // medium: topic & logic correct
    for (const id of ['B99-m-topic', 'B99-m-logic']) {
      m = updateMatrix(m, ans(byId(id), byId(id).correctIndex), byId(id));
    }
    // medium: extension WRONG, repeatedly choosing distractor option 1
    const ext = byId('B99-m-ext');
    for (let i = 0; i < 2; i++) {
      m = updateMatrix(m, ans(ext, 1), ext);
      log.push({ qid: ext.id, chose: 1, at: 't' });
    }
    // hard extension also wrong, same distractor → recurring misconception
    const hext = byId('B99-h-ext');
    m = updateMatrix(m, ans(hext, 1), hext);
    log.push({ qid: hext.id, chose: 1, at: 't' });

    // 1) the trigger fires
    expect(detectInconsistency(m)).toBe(true);

    // 2) it localizes the failing dimension to extension
    const diag = localize(m, log, pool);
    expect(diag.dimension).toBe('extension');

    // 3) confidence is the accuracy gap (extension ~0, others high) → high
    expect(diag.confidence).toBeGreaterThan(0.6);

    // 4) evidence carries the failing qids and the recurring misconception string
    expect(diag.evidence.qids).toEqual(expect.arrayContaining(['B99-m-ext', 'B99-h-ext']));
    expect(diag.evidence.recurringMisconceptions.length).toBeGreaterThan(0);

    // 5) it routes to the drill layer (extension → drill)
    expect(diag.remediation).toBe('drill');
  });
});

describe('localize — clear worst-dimension wins', () => {
  it('picks the lowest-accuracy known dimension when there is no tie', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;
    let m: PerformanceMatrix = emptyMatrix();
    const log: ChosenDistractor[] = [];
    // topic solid, logic solid, example fuzzy (1/2), extension worst (0/2)
    for (const id of ['B99-e-topic', 'B99-m-topic']) m = updateMatrix(m, ans(byId(id), byId(id).correctIndex), byId(id));
    for (const id of ['B99-e-logic', 'B99-m-logic']) m = updateMatrix(m, ans(byId(id), byId(id).correctIndex), byId(id));
    m = updateMatrix(m, ans(byId('B99-e-example'), byId('B99-e-example').correctIndex), byId('B99-e-example'));
    m = updateMatrix(m, ans(byId('B99-m-example'), 1), byId('B99-m-example'));
    log.push({ qid: 'B99-m-example', chose: 1, at: 't' });
    for (const id of ['B99-m-ext', 'B99-h-ext']) { m = updateMatrix(m, ans(byId(id), 1), byId(id)); }
    log.push({ qid: 'B99-m-ext', chose: 1, at: 't' }, { qid: 'B99-h-ext', chose: 1, at: 't' });

    const diag = localize(m, log, pool);
    expect(diag.dimension).toBe('extension');
    expect(diag.remediation).toBe('drill');
  });
});

describe('localize — tie-break by recurring misconception', () => {
  it('when two dimensions are equally weak, the one with the more-recurring distractor wins', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;
    let m: PerformanceMatrix = emptyMatrix();
    const log: ChosenDistractor[] = [];
    // logic 0/2 and extension 0/2 → equal accuracy; extension distractor recurs 3x vs logic 1x
    for (const id of ['B99-m-logic', 'B99-h-logic']) { m = updateMatrix(m, ans(byId(id), 1), byId(id)); }
    log.push({ qid: 'B99-m-logic', chose: 1, at: 't' });
    for (const id of ['B99-m-ext', 'B99-h-ext']) { m = updateMatrix(m, ans(byId(id), 1), byId(id)); }
    log.push({ qid: 'B99-m-ext', chose: 1, at: 't' }, { qid: 'B99-m-ext', chose: 1, at: 't' }, { qid: 'B99-h-ext', chose: 1, at: 't' });
    const diag = localize(m, log, pool);
    expect(diag.dimension).toBe('extension');
  });
});

describe('localize — confidence reflects the gap', () => {
  it('confidence equals best-known minus worst-known accuracy', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;
    let m: PerformanceMatrix = emptyMatrix();
    const log: ChosenDistractor[] = [];
    // topic 1.0 (best), extension 0.0 (worst) → gap = 1.0
    m = updateMatrix(m, ans(byId('B99-e-topic'), byId('B99-e-topic').correctIndex), byId('B99-e-topic'));
    for (const id of ['B99-m-ext', 'B99-h-ext']) { m = updateMatrix(m, ans(byId(id), 1), byId(id)); }
    log.push({ qid: 'B99-m-ext', chose: 1, at: 't' }, { qid: 'B99-h-ext', chose: 1, at: 't' });
    const diag = localize(m, log, pool);
    expect(diag.confidence).toBeCloseTo(1.0, 5);
    expect(diag.dimension).toBe('extension');
  });

  it('narrow gap yields low confidence', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;
    let m: PerformanceMatrix = emptyMatrix();
    const log: ChosenDistractor[] = [];
    // logic 1/2 = 0.5 (best), extension 0/2 = 0.0 (worst) → gap = 0.5
    m = updateMatrix(m, ans(byId('B99-e-logic'), byId('B99-e-logic').correctIndex), byId('B99-e-logic'));
    m = updateMatrix(m, ans(byId('B99-m-logic'), 1), byId('B99-m-logic'));
    log.push({ qid: 'B99-m-logic', chose: 1, at: 't' });
    for (const id of ['B99-m-ext', 'B99-h-ext']) { m = updateMatrix(m, ans(byId(id), 1), byId(id)); }
    log.push({ qid: 'B99-m-ext', chose: 1, at: 't' }, { qid: 'B99-h-ext', chose: 1, at: 't' });
    const diag = localize(m, log, pool);
    expect(diag.confidence).toBeCloseTo(0.5, 5);
  });
});
