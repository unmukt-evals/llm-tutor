// src/lib/source/diff.ts
// PURE, dependency-free line diff via LCS. Renders old → proposed in the review
// gate. `remove` lines precede `add` lines at each divergence (replace shows as
// remove-then-add). Empty old/new degrade to all-add / all-remove.

export type DiffKind = 'context' | 'add' | 'remove';
export interface DiffLine {
  kind: DiffKind;
  text: string;
}

function splitLines(s: string): string[] {
  // An empty string is zero lines (not one empty line) for diff purposes.
  return s.length === 0 ? [] : s.split('\n');
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'remove', text: a[i] });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'remove', text: a[i++] });
  while (j < m) out.push({ kind: 'add', text: b[j++] });
  return out;
}
