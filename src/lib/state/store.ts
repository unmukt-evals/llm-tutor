import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { StateStore, TutorState, ModuleState } from '@/lib/types';
import { defaultTutorState, defaultModuleState } from '@/lib/state/defaults';

const SIDECAR_FILENAME = '_llmtutor-state.json';

export class JsonStateStore implements StateStore {
  private readonly path: string;

  constructor(curriculumDir: string) {
    this.path = join(curriculumDir, SIDECAR_FILENAME);
  }

  async read(): Promise<TutorState> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (err: unknown) {
      // Missing sidecar (or any read error) → start from a clean default.
      if (isNotFound(err)) return defaultTutorState();
      throw err;
    }
    // Unparseable / invalid-shape JSON must not crash the app: fall back to default.
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaultTutorState();
      return { ...defaultTutorState(), ...(parsed as Partial<TutorState>) };
    } catch {
      return defaultTutorState();
    }
  }

  // NOTE: minimal working write — Task 15 hardens atomicity guarantees + ".md never touched".
  async write(s: TutorState): Promise<void> {
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8');
    await rename(tmp, this.path);
  }

  async getModule(id: string): Promise<ModuleState> {
    const state = await this.read();
    return state.modules[id] ?? defaultModuleState();
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
