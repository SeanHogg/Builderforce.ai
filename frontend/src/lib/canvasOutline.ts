/**
 * FINDING THINGS ON A BOARD.
 *
 * The canvas had exactly one search box and it searched the PALETTE — the list of
 * object TYPES you can add — despite being labelled "search everything". The
 * accessibility outline, the only surface that lists what is actually ON the
 * board, rendered every node in insertion order with no search, no filter and no
 * grouping. So past roughly thirty objects there was no way to answer "where is
 * the pricing deck", which is the point at which a board stops being usable.
 *
 * This module is the pure half of the fix: matching, ranking and bucketing over
 * node data, with no React and no canvas types beyond the two fields it reads.
 * The panel renders what these return.
 */

/** The minimum a node must expose to be findable. */
export interface OutlineSearchable {
  id: string;
  data: { kind: string; title: string; status?: unknown; subtitle?: unknown };
}

/** Free text is matched against these, in this order of significance. */
function haystack(node: OutlineSearchable): string {
  const { title, kind, status, subtitle } = node.data;
  return [title, kind, typeof status === 'string' ? status : '', typeof subtitle === 'string' ? subtitle : '']
    .join(' ')
    .toLowerCase();
}

/**
 * How well a node answers the query, or -1 for no match.
 *
 * Ranked rather than boolean because a board with forty tasks will match "task"
 * forty times, and the one whose TITLE says it should be first. A title prefix
 * beats a title hit beats a hit anywhere else; ties keep board order, so the
 * result is stable between keystrokes.
 */
export function outlineMatchScore(node: OutlineSearchable, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const title = node.data.title.toLowerCase();
  if (title.startsWith(q)) return 3;
  if (title.includes(q)) return 2;
  return haystack(node).includes(q) ? 1 : -1;
}

export interface OutlineFilterOptions {
  /** Free-text query. Empty matches everything. */
  query?: string;
  /** Restrict to one object kind. `'all'` (or omitted) does not restrict. */
  kind?: string;
}

/**
 * The nodes a query and kind filter select, best match first.
 *
 * Sorting only kicks in when there IS a query — with an empty box the outline
 * must stay in board order, because that order is what a screen-reader user has
 * been navigating and silently re-sorting it under them would be worse than not
 * having search at all.
 */
export function filterOutlineNodes<T extends OutlineSearchable>(nodes: readonly T[], options: OutlineFilterOptions = {}): T[] {
  const query = options.query?.trim() ?? '';
  const kind = options.kind && options.kind !== 'all' ? options.kind : null;
  const byKind = kind ? nodes.filter((node) => node.data.kind === kind) : [...nodes];
  if (!query) return byKind;
  return byKind
    .map((node, index) => ({ node, index, score: outlineMatchScore(node, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((entry) => entry.node);
}

/**
 * The kinds actually present, most-used first, for the filter chips.
 *
 * Derived from the board rather than from the object registry on purpose: a chip
 * for a kind nobody has placed is a dead control, and the registry currently
 * declares roughly ninety of them.
 */
export function outlineKindCounts(nodes: readonly OutlineSearchable[]): Array<{ kind: string; count: number }> {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.data.kind, (counts.get(node.data.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => (b.count - a.count) || a.kind.localeCompare(b.kind));
}
