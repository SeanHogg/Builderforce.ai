/** Small helpers shared by the pre-push modules. */
import { join, relative } from 'node:path';
import { toPosix } from './moduleImports.mjs';

export const SOURCE_RE = /\.(?:[cm]?[jt]sx?)$/;
export const TEST_RE = /(?:\.(?:test|spec)\.|(?:^|\/)(?:test|tests|__tests__)\/)/;

/** Split `items` into groups whose joined length stays under `budget` characters (Windows caps a command line near 8 KB). */
export function chunkByChars(items, budget = 6000) {
  const groups = [];
  let current = [];
  let size = 0;
  for (const item of items) {
    if (current.length && size + item.length + 1 > budget) { groups.push(current); current = []; size = 0; }
    current.push(item);
    size += item.length + 1;
  }
  if (current.length) groups.push(current);
  return groups;
}

/** `abs` as a forward-slash path relative to `<root>/<dir>` (may start with `../`). */
export const relativeTo = (root, dir, abs) => toPosix(relative(join(root, dir), abs));
