/**
 * Issue representatives and regressions (PRD 33 D15 "group into issues, never
 * browse raw sessions") — pure.
 *
 * REPRESENTATIVES. The recordings that hit an issue are grouped by the SHAPE of
 * their visit: each recording's ordered `steps` become a set of 2-grams (step →
 * next step), distance is Jaccard over those sets, and a small k-medoids picks up to
 * three medoids. Each medoid represents its cluster — rank by cluster size, `share`
 * the cluster's fraction, `label` the medoid's path. Deterministic: the first medoid
 * is the most central recording, each next one the farthest from those chosen.
 *
 * REGRESSION. An issue regressed when, after the site's newest release, its daily
 * rate (issue sessions / route sessions) sits above the interval it held before:
 * the after-release Wilson lower bound is above the before-release Wilson upper
 * bound (95%).
 */

export const MAX_REPRESENTATIVES = 3;
export const MAX_CANDIDATES = 200;
const KMEDOIDS_ROUNDS = 8;
const LABEL_MAX = 120;

export interface ClusterCandidate {
  recordingId: string;
  steps: readonly string[];
}

export interface Representative {
  rank: number;
  recordingId: string;
  share: number;
  label: string;
}

/** The set of consecutive step pairs; a one-step visit is its single step. */
export function bigrams(steps: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (steps.length === 1) out.add(steps[0]!);
  for (let i = 1; i < steps.length; i++) out.add(`${steps[i - 1]}\u001f${steps[i]}`);
  return out;
}

export function jaccardDistance(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter++;
  return 1 - inter / (a.size + b.size - inter);
}

/** `page:/a → event:x → page:/b`, trimmed to the label column. */
export function pathLabel(steps: readonly string[]): string {
  const text = steps.slice(0, 6).map((s) => s.replace(/^page:/, '')).join(' → ');
  return text.length <= LABEL_MAX ? text : `${text.slice(0, LABEL_MAX - 1)}…`;
}

/** Assign each point to its nearest medoid (ties → the earlier medoid). */
function assign(dist: number[][], medoids: number[]): number[] {
  return dist.map((row) => {
    let best = 0;
    for (let m = 1; m < medoids.length; m++) if (row[medoids[m]!]! < row[medoids[best]!]!) best = m;
    return best;
  });
}

/** Up to `k` representatives of the candidates (first {@link MAX_CANDIDATES}). */
export function pickRepresentatives(candidates: readonly ClusterCandidate[], k = MAX_REPRESENTATIVES): Representative[] {
  const items = candidates.slice(0, MAX_CANDIDATES);
  if (items.length === 0) return [];
  const sets = items.map((c) => bigrams(c.steps));
  const dist = sets.map((a) => sets.map((b) => jaccardDistance(a, b)));
  const total = (i: number) => dist[i]!.reduce((s, d) => s + d, 0);

  // Init: the most central point, then greedily the farthest from the chosen set.
  let first = 0;
  for (let i = 1; i < items.length; i++) if (total(i) < total(first)) first = i;
  const medoids = [first];
  while (medoids.length < Math.min(k, items.length)) {
    let far = -1;
    let farD = -1;
    for (let i = 0; i < items.length; i++) {
      if (medoids.includes(i)) continue;
      const d = Math.min(...medoids.map((m) => dist[i]![m]!));
      if (d > farD) { far = i; farD = d; }
    }
    // Every remaining point duplicates a medoid: more clusters would show the same visit twice.
    if (far < 0 || farD <= 0) break;
    medoids.push(far);
  }

  // Refine: each medoid becomes the member with the least total distance inside its cluster.
  let labels = assign(dist, medoids);
  for (let round = 0; round < KMEDOIDS_ROUNDS; round++) {
    let moved = false;
    for (let m = 0; m < medoids.length; m++) {
      const members = labels.map((l, i) => (l === m ? i : -1)).filter((i) => i >= 0);
      let best = medoids[m]!;
      let bestCost = members.reduce((s, i) => s + dist[i]![best]!, 0);
      for (const candidate of members) {
        const cost = members.reduce((s, i) => s + dist[i]![candidate]!, 0);
        if (cost < bestCost) { best = candidate; bestCost = cost; }
      }
      if (best !== medoids[m]) { medoids[m] = best; moved = true; }
    }
    if (!moved) break;
    labels = assign(dist, medoids);
  }

  return medoids
    .map((index, m) => ({ index, size: labels.filter((l) => l === m).length }))
    .sort((a, b) => b.size - a.size || a.index - b.index)
    .map(({ index, size }, rank) => ({
      rank: rank + 1,
      recordingId: items[index]!.recordingId,
      share: size / items.length,
      label: pathLabel(items[index]!.steps),
    }));
}

/** 95% Wilson score interval of `hits / n`. */
export function wilson(hits: number, n: number, z = 1.96): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  const p = Math.min(1, Math.max(0, hits / n));
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface RateWindow {
  /** Sessions that hit the issue. */
  hits: number;
  /** Sessions on the issue's route. */
  sessions: number;
}

/** Fewest route sessions on each side before a regression may be called. */
export const REGRESSION_MIN_SESSIONS = 30;

/** Whether the after-release rate sits above the before-release interval. */
export function isRegressed(before: RateWindow, after: RateWindow): boolean {
  if (before.sessions < REGRESSION_MIN_SESSIONS || after.sessions < REGRESSION_MIN_SESSIONS) return false;
  return wilson(after.hits, after.sessions).low > wilson(before.hits, before.sessions).high;
}
