// src/lib/state/deep-set.ts
// Pure deep-set used by the /api/state PATCH route.
// Returns a NEW object with `value` written at the given key `path`,
// cloning every object along the path so the input is never mutated.
// Read-modify-write callers (the route) preserve unknown keys by construction.

/**
 * Deep-set `value` at `path` within `obj`, returning a new object.
 * - Empty path returns `value` itself (replaces the whole document).
 * - Intermediate keys that are missing or non-objects are (re)created as objects.
 * - Does not mutate `obj` or any of its nested objects on the written path.
 */
export function deepSet<T>(obj: T, path: string[], value: unknown): T {
  if (path.length === 0) {
    return value as T;
  }

  const [head, ...rest] = path;
  const source: Record<string, unknown> =
    obj !== null && typeof obj === 'object' ? (obj as Record<string, unknown>) : {};
  const clone: Record<string, unknown> = { ...source };

  if (rest.length === 0) {
    clone[head] = value;
  } else {
    clone[head] = deepSet(source[head], rest, value);
  }

  return clone as T;
}
