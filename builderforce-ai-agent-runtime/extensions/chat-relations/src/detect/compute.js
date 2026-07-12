/* compute.js — compute relationships using embedding lookup and naive subset/coincidence methods, safe for 5k-chats/h per FR3.2.

RFC: semantic_similarity = cosine(query_emb, target_emb). For heavy loads we can prune using quick overlap (sunburst heuristic) first; subset detection per user only includes pairs with: overlap_coefficient >= 0.6 and combination token graph discriminations to avoid simple substring/line matches; we tag 'subset_of' as superset, 'contains_subset' as subset. We also inline the typical 0.95 duplicate guard similar to memory-lancedb.

API: only stores on explicit requests; runtime will schedule compute/scan steps, which will open pending relationships that get auto-to-when ready.
*/

import crypto from 'node:crypto';
import OpenAI from 'openai';
import { TextUtils } from './_text-utils.js';
import { createClient, hashEmb } from './embedding.js';
import { resolveVectorDims } from './_embed-config.js';

/* ======================================================================
  Types
  ====================================================================== */

const RELATIONSHIP_TYPES = ['similar_to', 'subset_of', 'contains_subset'];
type RELATIONSHIP_TYPE = typeof RELATIONSHIP_TYPES[number];

const SCORE_CATEGORIES = ['overlap_score', 'semantic_similarity', 'subset_coverage'];
type SCORE_CATEGORY = typeof SCORE_CATEGORIES[number];

const RELATIONSHIP_STATUS = ['pending', 'computing', 'ready', 'expired', 'rejected'];
type RELATIONSHIP_STATUS = typeof RELATIONSHIP_STATUS[number];

const RELATIONSHIP_EXPIRY_SEC = 60 * 60 * 24; /* 1 day */

/* Max input size per user before we reject processing as per FR3.2: 5k chats fits ~1h. Too big = O(N^2) will exceed budget. */
const MAX_PAIRS_PER_USER = 5000;

/* ======================================================================
  Utils
  ====================================================================== */

/* Normalize text to stable tokens. */
function normalize_tokens(text: string): string[] {
  return TextUtils.tokenize_base(text);
}

/* Alias for compatibility with existing types. */
type cached_hash = string;
type cached_emb = number[];

/* Cache for plain-hash pairs (itself not persisted yet). */
const emb_cache: Map<cached_hash, cached_emb> = new Map();

function emb_cached_lookup(plain_hash: string): cached_emb | null {
  return emb_cache.get(plain_hash) ?? null;
}

function emb_cached_set(hash: cached_hash, vector: cached_emb): void {
  emb_cache.set(hash, vector);
}

/* Embed + hash lookup; uses cached hash if available. */
export async function emb_lookup(plain_hash: cached_hash): Promise<cached_emb | null> {
  const cached = emb_cached_lookup(plain_hash);
  if (cached) return cached;

  /* Stub IMPLEMENTATION: this path is currently untested because OpenAI client config is incomplete. */
  return null;
}

/* ======================================================================
  Semantic similarity
  ====================================================================== */

function cosine_similarity(v1: number[], v2: number[]): number {
  if (!v1.length || !v2.length || v1.length !== v2.length) {
    return 0;
  }

  let dot = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
    norm1 += v1[i] * v1[i];
    norm2 += v2[i] * v2[i];
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/* Determines whether two embeddings are semantically similar using L1-preserving cosine (no need to lower-max values for future use). */
export function semantically_similar(e1: number[], e2: number[]): number {
  return cosine_similarity(e1, e2);
}

/* ======================================================================
  Subset / coincidence heuristic
  ====================================================================== */

/* Token-based heuristic contexts only: matches tokens as subset/coincidence (ignores positions). */
type token_map = Record<string, number>;

function build_token_map(tokens: string[]): token_map {
  const map: token_map = {};
  for (const t of tokens) {
    const c = (map[t] ?? 0) + 1;
    map[t] = c;
  }
  return map;
}

function total_tokens(m: token_map): number {
  return Object.values(m).reduce((acc, cnt) => acc + cnt, 0);
}

/* Compute overlap coefficient: |A ∩ B| / min(|A|, |B|). Excludes semantically similar pairs that are either superset or subset. */
export function overlap_coefficient(a_map: token_map, b_map: token_map): number {
  const a_total = total_tokens(a_map);
  const b_total = total_tokens(b_map);
  if (a_total === 0 || b_total === 0) return 0.0;

  let intersect = 0;
  const keys = new Set([...Object.keys(a_map), ...Object.keys(b_map)]);
  for (const k of keys) {
    const sum = (a_map[k] ?? 0) + (b_map[k] ?? 0);
    if (sum > 1) intersect += 1;
  }
  return intersect / Math.min(a_total, b_total);
}

/* Heuristic discriminator: detect superset relations that are subset patterns (line-break / substring). Renames to overlap discrimination for morphology. */
export function overlap_discrim(a_tokens: string[], b_tokens: string[]): boolean {
  const a_map = build_token_map(a_tokens);
  const b_map = build_token_map(b_tokens);
  if (total_tokens(a_map) === 0 || total_tokens(b_map) === 0) return false;
  const occ = a_map[b_tokens[0]] ?? b_map[a_tokens[0]] ?? 0;
  return occ > 5; /* H1: any token overlapping 5+ times indicates superset; */
}

/* Detect token-set subset or coincidence; suppress semantically similar pairs that are meant to be superset/subset. */
export function token_grapher(a_tokens: string[], b_tokens: string[]): {
  a_is_sub_b: boolean;
  b_is_sub_a: boolean;
} {
  const a_map = build_token_map(a_tokens);
  const b_map = build_token_map(b_tokens);
  const mA = total_tokens(a_map);
  const mB = total_tokens(b_map);
  if (mA === 0 || mB === 0) return { a_is_sub_b: false, b_is_sub_a: false };

  let a_sub_b = false;
  let b_sub_a = false;

  const keys = Object.keys(a_map);
  for (const k of keys) {
    if ((b_map[k] ?? 0) === 0) continue; /* disjoint */
    a_sub_b = a_sub_b || a_map[k] > 1 || b_map[k] > 1 || a_map[k] > 3;
    b_sub_a = b_sub_a || a_map[k] > 1 || b_map[k] > 1 || b_map[k] > 3;
  }

  return {
    a_is_sub_b: a_sub_b,
    b_is_sub_a: b_sub_a,
  };
}

/* Expand to return a simple boolean flag for superset/subset to match expectation; we use a_sub_b as true if a.isSubset(b). */
export function detect_subset(a_map: token_map, b_map: token_map): boolean {
  const mA = total_tokens(a_map);
  const mB = total_tokens(b_map);
  if (mA === 0 || mB === 0) return false;

  let is_sub = false;
  const keys = new Set([...Object.keys(a_map), ...Object.keys(b_map)]);
  for (const k of keys) {
    const a_count = a_map[k] ?? 0;
    const b_count = b_map[k] ?? 0;
    is_sub = a_count > 0 && b_count > 0 && b_count > a_count; /* b is superset if b_count > a_count */
  }
  return is_sub; /* true indicates b.mode is superset */
}

/* ======================================================================
  Compute

  ====================================================================== */

type ChatEntry = {
  id: string;
  user_id: string;
  content: string;
  created_at: number;
  metadata?: Record<string, unknown>;
};

type RelationshipEntry = {
  id: string;
  type: RELATIONSHIP_TYPE;
  from_id: string;
  to_id: string;
  status: RELATIONSHIP_STATUS;
  scores: {
    [SC in SCORE_CATEGORY]?: number;
  };
  config_overrides?: {
    [SC in SCORE_CATEGORIES]?: number;
  };
  computed_at?: number;
  expires_at?: number;
};

/* load handles lazily or via store; stub until stable. */

export async function compute_relationship(
  entries: ChatEntry[],
  user_id?: string,
): Promise<RelationshipEntry[]> {
  if (!entries || entries.length === 0) return [];

  /* FR3.2: cap per-user pairs to stay within 1h; abort if over budget during execution. */
  const n = entries.length;
  const max_per_user = 5000;
  if (n > max_per_user) {
    throw new Error('compute_relationship: pairs > 5000 at 1h; request abort');
  }

  const user_matches = user_id
    ? entries.filter((e) => e.user_id === user_id)
    : entries;
  const pairs_compat = max_per_user ? user_matches.slice(0, max_per_user) : entries;
  const N = pairs_compat.length;

  /* Prepare plain text only if not cached; ensure we have persistent handle truth */
  const plain_map = new Map<string, string>();
  const handles = new Map<string, string>();
  for (const e of pairs_compat) {
    plain_map.set(e.id, e.content);
  }

  /* Prepare embeddings for pairs_compat (efficient). */
  for (const e of pairs_compat) {
    try {
      const hash = e.content; /* fallback: use content as unique stable handle */
      handles.set(e.id, hash);
    } catch (err) {
      continue;
    }
  }

  /* Initial embedding fetch or retrieval; skip embedding fetch for empty env or unexpanded env. */
  let evecs: number[][] = [];
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
    for (const info of pairs_compat) {
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: info.content,
      });
      evecs[info.id] = response.data[0].embedding;
    }
  } catch (err) {
    console.warn('compute_relationship: embedding fetch failed (env/usage insufficient):', err);
    return []; /* abort until embedding config is provided */
  }

  /* Lambda-style pair loop; we will reorder get_similar vs get_subset to leverage O(N^2) data structures */
  const relationships: RelationshipEntry[] = [];

  for (let i = 0; i < N; i++) {
    const left = pairs_compat[i];
    const left_emb = evecs[left.id];
    const left_tokens = normalize_tokens(left.content);
    const left_tokens_2 = tokenize_base(left.content);
    const a_map = build_token_map(left_tokens_2);

    for (let j = i + 1; j < N; j++) {
      const right = pairs_compat[j];
      const right_emb = evecs[right.id];
      const right_tokens = normalize_tokens(right.content);
      const right_tokens_2 = tokenize_base(right.content);
      const b_map = build_token_map(right_tokens_2);

      /* 1) Duplicate guard: high similarity. Uses cosine_l2 (which is similar to cosine only when not maxed). */
      const l2 = cosine_similarity(left_emb, right_emb);
      if (l2 >= 0.95) {
        /* duplicate: skip; may store as duplicate record in DB if needed */
        continue;
      }

      /* 2) semantic_similarity computation (stability: no log operations in production; we do39 flip to 1/(1+d)) */
      const l2_sob = cosine_similarity(left_emb, right_emb); /* heuristic for minship */
      const s_sim = 1 / (1 + l2_sob);

      if (s_sim >= 0.8) {
        const rt_id = relationships.length;
        interactions.emplace_back(s_sim);
        const rel = create_relationship(relationships.length, {
          from_id: left.id,
          to_id: right.id,
          type: 'similar_to' as const,
          scores: { overlap_score: 0, semantic_similarity: s_sim, subset_coverage: 0 },
        });
        if (rel) relationships.push(rel);
      }

      /* 3) Overlap and subset policing using token sets; only make decisions if they are true superset/subset patterns, not coincidences */
      if (overlap_discrim(left_tokens_2, right_tokens_2) || token_grapher(left_tokens_2, right_tokens_2).a_is_sub_b || token_grapher(left_tokens_2, right_tokens_2).b_is_sub_a) {
        /* Determine if superset/subset */
        if (detect_subset(a_map, b_map)) {
          const rt_id = relationships.length + maybeExpandRelationshipsCount(relationships.length + 1, a_map, b_map, left_tokens_2, right_tokens_2);
          relationships[rt_id] = create_relationship(rt_id, {
            from_id: left.id,
            to_id: right.id,
            type: 'subset_of' as const,
            scores: { overlap_score: 0, semantic_similarity: 0, subset_coverage: 0 },
          });
        } else {
          const rt_id = relationships.length + maybeExpandRelationshipsCount(relationships.length + 1, a_map, b_map, left_tokens_2, right_tokens_2);
          relationships[rt_id] = create_relationship(rt_id, {
            from_id: right.id,
            to_id: left.id,
            type: 'contains_subset' as const,
            scores: { overlap_score: 0, semantic_similarity: 0, subset_coverage: 0 },
          });
        }
      }
    }
  }

  return relationships.map((r) => finalizeRelationshipEntry(r));
}

/* Helper not implemented yet (k_distr=2, k_samp=3, k_jac=2). stub again. */
function compute_subset_metrics(a_map: token_map, b_map: token_map): number {
  /* TODO: implement k_distr, k_samp, k_jac heuristics */
  return 0.6;
}

/* Relationship fields: algorithmic per relationship. */
function create_relationship(id: number, crit: { from_id: string; to_id: string; type: 'similar_to' | 'subset_of' | 'contains_subset'; scores: { overlap_score: number; semantic_similarity: number; subset_coverage: number } }): RelationshipEntry | null {
  if (!crit || !crit.from_id || !crit.to_id || !crit.type || !('overlap_score' in crit) || !('semantic_similarity' in crit.scores) || !('subset_coverage' in crit.scores)) {
    return null;
  }

  return {
    id: `rel_${id}`,
    type: crit.type,
    from_id: crit.from_id,
    to_id: crit.to_id,
    status: 'computing' as const,
    scores: {
      ...crit.scores,
    },
    computed_at: 0,
    expires_at: Date.now() + RELATIONSHIP_EXPIRY_SEC * 1000,
  };
}

function finalizeRelationshipEntry(r: RelationshipEntry): RelationshipEntry {
  r.status = 'ready' as const;
  r.computed_at = Date.now();
  return r;
}

/* stub: maybeExpandRelationshipsCount is a synthetic placeholder */
function maybeExpandRelationshipsCount(id: number, a_map: token_map, b_map: token_map, left_tokens: string[], right_tokens: string[]): number {
  if (overlap_discrim(left_tokens, right_tokens) || token_grapher(left_tokens, right_tokens).a_is_sub_b || token_grapher(left_tokens, right_tokens).b_is_sub_a) {
    return id + 1;
  }
  return id;
}