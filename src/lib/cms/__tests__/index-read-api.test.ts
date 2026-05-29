import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getCmsIndex, __resetCmsIndexForTests } from '@/lib/cms/index';
import { getCurriculumRepository } from '@/lib/ingest';
import { defaultModuleState } from '@/lib/state/defaults';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/curriculum');

describe('getCmsIndex read API', () => {
  let dir: string;
  beforeEach(async () => {
    __resetCmsIndexForTests();
    dir = await mkdtemp(join(tmpdir(), 'cms-read-'));
    await cp(FIXTURE_DIR, dir, { recursive: true });
  });
  afterEach(async () => {
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('getCurriculum returns the existing Curriculum shape (tracks + ordered modules + byId)', async () => {
    const cms = await getCmsIndex(dir, { dbPath: ':memory:' });
    const curriculum = cms.getCurriculum();
    expect(curriculum.tracks).toEqual(['B']);
    expect(curriculum.modules.map((m) => m.id)).toEqual(['B01']);
    expect(curriculum.byId('B01')?.name).toBe('Eval harnesses & harness engineering');
    expect(curriculum.byId('NOPE')).toBeUndefined();
  });

  it('getCurriculum() deep-equals the existing CurriculumRepository.load(dir) for the fixture', async () => {
    const cms = await getCmsIndex(dir, { dbPath: ':memory:' });
    const fromCache = cms.getCurriculum();
    const fromRepo = await getCurriculumRepository().load(dir);

    // Functions (byId) can't be deep-equaled directly; compare the data slices.
    expect(fromCache.tracks).toEqual(fromRepo.tracks);
    expect(fromCache.modules).toEqual(fromRepo.modules);
    expect(fromCache.byId('B01')).toEqual(fromRepo.byId('B01'));
  });

  it('getModule returns Module | undefined; getPool returns MCQPool | null', async () => {
    const cms = await getCmsIndex(dir, { dbPath: ':memory:' });
    expect(cms.getModule('B01')?.track).toBe('B');
    expect(cms.getModule('NOPE')).toBeUndefined();
    expect(cms.getPool('B01')?.questions.length).toBe(2);
    expect(cms.getPool('NOPE')).toBeNull();
  });

  it('getFlashcardsText returns the raw deck text; getFlashcards returns parsed rows', async () => {
    const cms = await getCmsIndex(dir, { dbPath: ':memory:' });
    const text = cms.getFlashcardsText();
    expect(text).toContain('module:B01');
    const cards = cms.getFlashcards();
    expect(cards.length).toBe(2);
    expect(cards[0]?.moduleId).toBe('B01');
  });

  it('getModuleState returns the cached state when present, defaultModuleState() when absent', async () => {
    const cms = await getCmsIndex(dir, { dbPath: ':memory:' });
    expect(cms.getModuleState('B01').mastery).toBe('solid');
    expect(cms.getModuleState('NEW')).toEqual(defaultModuleState());
  });

  it('getAppState returns the version/xp/streak/sessionLog slice of TutorState', async () => {
    const cms = await getCmsIndex(dir, { dbPath: ':memory:' });
    const app = cms.getAppState();
    expect(app.version).toBe(1);
    expect(app.xp).toEqual({ total: 42, thisWeek: 7 });
    expect(app.streak.count).toBe(3);
    expect(Array.isArray(app.sessionLog)).toBe(true);
  });

  it('reindexEntity / reindexState / reindexAll are callable', async () => {
    const cms = await getCmsIndex(dir, { dbPath: ':memory:' });
    await expect(cms.reindexEntity('module', 'B01')).resolves.toBeDefined();
    await expect(cms.reindexState()).resolves.toBeDefined();
    await expect(cms.reindexAll()).resolves.toBeDefined();
  });

  it('falls back to default app state when the sidecar is missing', async () => {
    // Use a brand-new dir with no fixtures — the lazy refresh hits an empty
    // CURRICULUM_DIR and indexState lands defaults.
    const emptyDir = await mkdtemp(join(tmpdir(), 'cms-read-empty-'));
    try {
      const cms = await getCmsIndex(emptyDir, { dbPath: ':memory:' });
      const app = cms.getAppState();
      expect(app.version).toBe(1);
      expect(app.xp).toEqual({ total: 0, thisWeek: 0 });
      expect(cms.getModuleState('B01')).toEqual(defaultModuleState());
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
