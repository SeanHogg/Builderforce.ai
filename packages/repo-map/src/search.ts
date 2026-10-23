/**
 * Keyword search over the map's definitions — the `semantic_search` a surface WITHOUT
 * a chunk index can still answer honestly. A definition matches by the same
 * identifier-aware terms bf-index's keyword mode uses (`resolveMembership` matches
 * "membership"); ties break by the file's PageRank, so the definition the rest of the
 * code depends on comes first. Hits carry the signature line, not a body: there is no
 * chunk text in the graph, so the caller reads the hit's line next.
 */

import { personalization } from './render.js';
import type { RepoGraph } from './repoGraph.js';
import { queryTerms, searchTerms, splitIdentifier } from './terms.js';

export interface RepoSymbolHit {
  path: string;
  line: number;
  symbol: string;
  signature: string;
  score: number;
}

/** A term matching the definition's NAME weighs this much more than one matching its path. */
const NAME_WEIGHT = 2;
const PATH_WEIGHT = 1;
/** Bonus when the query spells the whole name. */
const EXACT_NAME_BONUS = 3;

export function searchRepoSymbols(
  repo: RepoGraph,
  query: string,
  opts: { limit: number; scope?: string | null },
): RepoSymbolHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const scope = (opts.scope ?? '').replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/+$/, '');
  const rank = repo.graph.pagerank(personalization(repo, { maxTokens: 0, query }));
  const pathTerms = new Map<string, Set<string>>();
  const hits: RepoSymbolHit[] = [];
  for (const s of repo.symbols) {
    if (scope && s.path !== scope && !s.path.startsWith(`${scope}/`)) continue;
    let pt = pathTerms.get(s.path);
    if (!pt) pathTerms.set(s.path, (pt = new Set(s.path.split('/').flatMap((seg) => searchTerms(seg)))));
    const nameTerms = new Set([...splitIdentifier(s.name), s.name.toLowerCase()]);
    let score = 0;
    for (const t of terms) {
      if (nameTerms.has(t)) score += NAME_WEIGHT;
      else if (pt.has(t)) score += PATH_WEIGHT;
    }
    if (score === 0) continue;
    if (terms.includes(s.name.toLowerCase())) score += EXACT_NAME_BONUS;
    const i = repo.graph.indexOf(s.path);
    hits.push({ path: s.path, line: s.line, symbol: s.name, signature: s.signature, score: score + (i === undefined ? 0 : rank[i] ?? 0) });
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  return hits.slice(0, Math.max(1, opts.limit));
}
