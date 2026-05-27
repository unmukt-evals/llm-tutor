import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
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

  // Atomic write: serialize to a temp file on the same filesystem, then rename
  // over the sidecar (atomic on the same fs). The app NEVER writes any `.md`.
  // If the rename fails, the temp file is cleaned up so no orphaned `.tmp`
  // is left behind; the original error is preserved and re-thrown.
  async write(s: TutorState): Promise<void> {
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8');
    try {
      await rename(tmp, this.path);
    } catch (err: unknown) {
      // Best-effort cleanup of the orphaned temp; don't mask the original error.
      await unlink(tmp).catch(() => {});
      throw err;
    }
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
