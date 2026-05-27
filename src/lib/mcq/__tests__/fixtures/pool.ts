// Typed accessor for the hand-authored B99 fixture pool.
//
// The JSON is the canonical on-disk pool format (matches mcq/<moduleId>.json that
// the repository loads at runtime). But `resolveJsonModule` widens string literals
// (e.g. "easy") to `string`, so a raw JSON import is not directly assignable to
// MCQPool's union-typed fields (Difficulty / Dimension). This module re-exports the
// same data narrowed to the shared MCQPool type, giving tests a typechecked handle
// while keeping the JSON as the single source of fixture content.
import type { MCQPool } from '@/lib/types';
import raw from './B99-fixture.json';

export const B99_POOL = raw as MCQPool;
export default B99_POOL;
