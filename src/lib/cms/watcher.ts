import 'server-only';
import { basename, relative, sep } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

import type { CmsIndex } from '@/lib/cms/index';
import type { EntityKind } from '@/lib/cms/types';

/**
 * Phase 3 — filesystem watcher that keeps the CMS mirror in sync with hand
 * edits to the curriculum dir. Dev-only by default: production reads through
 * Phase 1's mtime + hash lazy refresh and never starts a watcher.
 *
 * Design:
 *  - process-wide singleton keyed on `dir` (calling `startWatcher` twice for
 *    the same dir is a no-op and returns the existing handle),
 *  - per-path debounce (50ms) coalesces editor "save" bursts into one reindex,
 *  - all reindex callbacks are wrapped in try/catch and log via console.warn —
 *    the watcher must keep running across filesystem races,
 *  - cleanly stops via `handle.stop()` (tests + future shell-layout teardown).
 *
 * Classification (the only tracked surfaces — everything else is ignored):
 *   - `<id>-<slug>.md` (or `<id>.md`) at the top level → ('module', id)
 *   - `mcq/<id>.json`                                  → ('pool', id)
 *   - `_flashcards.md`                                 → ('flashcards', '_flashcards')
 *   - `_llmtutor-state.json`                           → ('state', '_')
 *
 * Deletion (`unlink`) is forwarded to `cms.reindexEntity`, which Phase 3 taught
 * to detect missing files and drop the cached rows.
 */

export interface WatcherHandle {
  /** Stop the underlying chokidar watcher and clear any pending debounce timers.
   *  Safe to call multiple times; subsequent calls are no-ops. */
  stop(): Promise<void>;
}

export interface StartWatcherOptions {
  /** Bypass the `NODE_ENV !== 'production'` gate. Tests use this; production
   *  call sites should never set it. */
  force?: boolean;
  /** Debounce window in ms per path. Defaults to 50ms — long enough to coalesce
   *  the multi-write bursts editors emit on save, short enough to feel instant. */
  debounceMs?: number;
}

interface WatcherEntry {
  handle: WatcherHandle;
  fsw: FSWatcher;
  timers: Map<string, NodeJS.Timeout>;
  stopped: boolean;
}

const watchers = new Map<string, WatcherEntry>();

/** Open (or return the cached) watcher for `dir`. Idempotent. Returns `null`
 *  in production when `force` is not set — production never watches. */
export function startWatcher(
  dir: string,
  cms: CmsIndex,
  opts: StartWatcherOptions = {},
): WatcherHandle | null {
  const gated = process.env.NODE_ENV === 'production' && !opts.force;
  if (gated) return null;

  const existing = watchers.get(dir);
  if (existing) return existing.handle;

  const debounceMs = opts.debounceMs ?? 50;
  const timers = new Map<string, NodeJS.Timeout>();

  const fsw = chokidar.watch(dir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
    ignored: (p) => {
      // ignore the SQLite cache + its WAL / SHM sidecars
      const b = basename(p);
      if (b.startsWith('.llmtutor-cache.sqlite')) return true;
      // ignore anything under a deeper mcq/ subdir (we only care about
      // `<dir>/mcq/*.json`, no nested folders)
      return false;
    },
  });

  const schedule = (path: string, kind: 'change' | 'unlink' | 'add'): void => {
    const cls = classifyPath(dir, path);
    if (!cls) return;
    const key = `${cls.kind}::${cls.id}`;
    const existingTimer = timers.get(key);
    if (existingTimer) clearTimeout(existingTimer);
    const t = setTimeout(() => {
      timers.delete(key);
      void (async () => {
        try {
          if (cls.kind === 'state') {
            await cms.reindexState();
          } else {
            const res = await cms.reindexEntity(cls.kind, cls.id);
            if (res.error) {
              console.warn(
                `[cms.watcher] reindex ${cls.kind}/${cls.id} (${kind}) failed: ${res.error}`,
              );
            }
          }
        } catch (err) {
          // Belt + braces: reindexEntity catches its own throws, but if any
          // future writer slips through we never let the watcher die.
          console.warn(
            `[cms.watcher] reindex ${cls.kind}/${cls.id} (${kind}) threw: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      })();
    }, debounceMs);
    timers.set(key, t);
  };

  fsw.on('add', (p) => schedule(p, 'add'));
  fsw.on('change', (p) => schedule(p, 'change'));
  fsw.on('unlink', (p) => schedule(p, 'unlink'));
  fsw.on('error', (err) => {
    console.warn(`[cms.watcher] error: ${err instanceof Error ? err.message : String(err)}`);
  });

  const entry: WatcherEntry = {
    fsw,
    timers,
    stopped: false,
    handle: {
      async stop() {
        if (entry.stopped) return;
        entry.stopped = true;
        for (const t of timers.values()) clearTimeout(t);
        timers.clear();
        try {
          await fsw.close();
        } catch {
          // best effort
        }
        watchers.delete(dir);
      },
    },
  };
  watchers.set(dir, entry);
  return entry.handle;
}

/** Test-only — stop all watchers + clear the singleton map. */
export async function __stopAllWatchersForTests(): Promise<void> {
  const entries = Array.from(watchers.values());
  watchers.clear();
  await Promise.all(
    entries.map(async (e) => {
      e.stopped = true;
      for (const t of e.timers.values()) clearTimeout(t);
      e.timers.clear();
      try {
        await e.fsw.close();
      } catch {
        // best effort
      }
    }),
  );
}

/** Map an absolute path under `dir` to the (kind, id) the indexer recognizes,
 *  or `null` if the path isn't a tracked surface. Pure function. */
export function classifyPath(
  dir: string,
  absPath: string,
): { kind: EntityKind; id: string } | null {
  const rel = relative(dir, absPath);
  if (rel === '' || rel.startsWith('..') || rel.includes(`${sep}..`)) return null;
  const parts = rel.split(sep);

  if (parts.length === 1) {
    const file = parts[0];
    if (file === '_flashcards.md') return { kind: 'flashcards', id: '_flashcards' };
    if (file === '_llmtutor-state.json') return { kind: 'state', id: '_' };
    if (file === '_sources.json') return { kind: 'source', id: '_sources' };
    if (file.endsWith('.md') && !file.startsWith('_')) {
      // `<id>-<slug>.md` OR `<id>.md`. Strip `.md` then split on the first `-`.
      const base = file.slice(0, -3);
      const dash = base.indexOf('-');
      const id = dash === -1 ? base : base.slice(0, dash);
      if (id.length === 0) return null;
      return { kind: 'module', id };
    }
    return null;
  }

  if (parts.length === 2 && parts[0] === 'mcq' && parts[1].endsWith('.json')) {
    return { kind: 'pool', id: parts[1].slice(0, -5) };
  }

  return null;
}
