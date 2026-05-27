import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Curriculum, CurriculumRepository, Module, TrackId } from '@/lib/types';
import { parseModule } from '@/lib/ingest/parse-module';

function makeCurriculum(modules: Module[]): Curriculum {
  const index = new Map(modules.map((m) => [m.id, m]));
  const tracks = Array.from(new Set(modules.map((m) => m.track))).sort() as TrackId[];
  return {
    tracks,
    modules,
    byId(id: string) {
      return index.get(id);
    },
  };
}

export class CurriculumRepositoryImpl implements CurriculumRepository {
  async load(dir: string): Promise<Curriculum> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      // only actual module markdown: skip non-md and _-prefixed sidecars
      // (_sources.md, _flashcards.md, _curriculum.md, _progress.md, …)
      .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
      .sort();

    const modules: Module[] = [];
    for (const name of files) {
      try {
        const raw = await readFile(join(dir, name), 'utf8');
        const mod = parseModule(raw);
        // skip any .md file that has no module_id in frontmatter (e.g. README.md)
        if (mod.id) modules.push(mod);
      } catch (err) {
        console.warn(`[curriculum] skipping ${name}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return makeCurriculum(modules);
  }
}
