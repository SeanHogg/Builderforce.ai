/**
 * Evermind recall scoring — the shared, deterministic "which learned memory would
 * answer this task?" ranker behind the console's **Validate** action.
 *
 * The project Evermind's real retrieval is SSM-embedding recall in the runtime, but
 * loading + embedding inside a Worker route is far too heavy for an interactive
 * "what would this recall?" preview. This is the lexical preview: a TF-cosine over
 * the tokens of the query vs each retained contribution's (prompt + learned text).
 * It is honest about what it is — a lexical recall preview over the inspectable
 * recent-contributions ring — and cheap enough to run inside the cached read.
 *
 * Delta contributions carry no text, so they never match (correct: "which memory
 * answers this" is about episodic taught memories, not weight deltas).
 */

/** One contribution the ranker scores (a subset of the recent-ring entry shape). */
export interface RecallScorable {
  id: number;
  kind: 'text' | 'delta';
  version: number;
  at: number;
  weight: number;
  prompt?: string;
  text?: string;
}

/** A scored recall match — the entry plus its 0..1 relevance to the query. */
export interface RankedRecall extends RecallScorable {
  /** Lexical relevance to the query, 0..1 (rounded to 3 dp). */
  score: number;
}

/** Tiny code+English stopword set — dropped so recall keys on meaningful terms. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are',
  'be', 'as', 'at', 'by', 'it', 'this', 'that', 'from', 'you', 'your', 'i', 'we',
  'they', 'he', 'she', 'can', 'will', 'how', 'do', 'does', 'what', 'why', 'when',
  'which', 'use', 'using', 'used', 'please', 'need', 'want', 'me', 'my', 'so', 'if',
]);

/** Lowercase, split on non-word runs, drop stopwords + 1-char tokens. */
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Term-frequency map for a token list. */
function termFreq(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const tok of tokens) m.set(tok, (m.get(tok) ?? 0) + 1);
  return m;
}

/** Cosine similarity between two TF maps (0..1). Iterates the smaller map. */
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let na = 0;
  for (const v of a.values()) na += v * v;
  let nb = 0;
  for (const v of b.values()) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, v] of small) {
    const w = big.get(k);
    if (w) dot += v * w;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Below this cosine a match is noise, not recall — dropped from the result. */
const MIN_SCORE = 0.02;

/**
 * Rank the recent contributions by lexical relevance to `prompt`, best first.
 * Only contributions carrying text (prompt/learned text) can match; scores below
 * {@link MIN_SCORE} are dropped, and the result is capped at `limit` (default 8).
 */
export function rankEvermindRecall(
  prompt: string,
  recent: readonly RecallScorable[],
  opts?: { limit?: number },
): RankedRecall[] {
  const q = termFreq(tokenize(prompt));
  if (q.size === 0) return [];
  const scored: RankedRecall[] = [];
  for (const e of recent) {
    const hay = `${e.prompt ?? ''} ${e.text ?? ''}`.trim();
    if (!hay) continue;
    const score = cosine(q, termFreq(tokenize(hay)));
    if (score > MIN_SCORE) scored.push({ ...e, score: Math.round(score * 1000) / 1000 });
  }
  scored.sort((a, b) => b.score - a.score || b.at - a.at);
  return scored.slice(0, Math.max(1, opts?.limit ?? 8));
}

/** Stable, bounded hash of a validate prompt — keeps the recall cache key finite. */
export function hashRecallPrompt(prompt: string): string {
  let h = 5381;
  for (let i = 0; i < prompt.length; i++) h = ((h << 5) + h + prompt.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
