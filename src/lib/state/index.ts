// S-STATE public surface. §7 factory: getStateStore(curriculumDir) → StateStore.
// The dir tells the store where _llmtutor-state.json lives.
import type { StateStore } from '@/lib/types';
import { JsonStateStore } from '@/lib/state/store';

export function getStateStore(curriculumDir: string): StateStore {
  return new JsonStateStore(curriculumDir);
}
