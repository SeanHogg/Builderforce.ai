/**
 * Learned Model Routing (PRD 13) — joining FLEET stats to LOCAL model candidates.
 *
 * The two sides name models differently and neither is wrong. The fleet table is keyed
 * by the gateway's catalog id (`anthropic/claude-opus-4`, `@cf/qwen/qwen2.5-coder-32b`)
 * because that is what a cloud run dispatched. This host names a model by the
 * `provider` it discovered it under plus the id that provider serves, which may be a
 * bare slug (`openai` + `gpt-5.3-codex`) or already qualified.
 *
 * So the join is done EXPLICITLY here rather than being assumed anywhere downstream,
 * and it is conservative: a stat is attached to a candidate only on an exact key match
 * or an unambiguous suffix match on the model id. A stat that could belong to two
 * candidates is attached to NEITHER — crediting the wrong candidate would seed a model
 * on another model's record, which is worse than seeding on no record at all.
 *
 * PURE — no I/O.
 */

import type { ActionModelRankStat } from "@builderforce/learned-routing";

/** A model this host can actually run, in the curated order it was configured in. */
export interface ModelCandidate {
  provider: string;
  model: string;
}

/** The stable key a candidate is ranked under. */
export function candidateKey(c: ModelCandidate): string {
  return `${c.provider}/${c.model}`;
}

/** Lowercased id with any `<vendor>/` (or `@cf/<org>/`) prefix stripped — the part
 *  that actually names the model. */
function bareModelId(id: string): string {
  const parts = id.toLowerCase().split("/");
  return parts[parts.length - 1] ?? id.toLowerCase();
}

/**
 * Re-label the fleet's per-model stats onto this host's candidate keys, dropping any
 * stat that matches no candidate or more than one.
 *
 * The output is what `rankModelsForAction` consumes alongside
 * `candidates.map(candidateKey)`, so the ranker sees one consistent key space and
 * still returns a permutation of the caller's own candidates.
 */
export function alignStatsToCandidates(
  candidates: readonly ModelCandidate[],
  stats: readonly ActionModelRankStat[] | undefined,
): ActionModelRankStat[] {
  if (!stats || stats.length === 0 || candidates.length === 0) {
    return [];
  }
  const keyed = candidates.map((c) => ({
    key: candidateKey(c),
    exact: candidateKey(c).toLowerCase(),
    bare: bareModelId(c.model),
  }));

  const aligned: ActionModelRankStat[] = [];
  const claimed = new Set<string>();
  for (const stat of stats) {
    const statId = stat.model?.trim();
    if (!statId) {
      continue;
    }
    const statLower = statId.toLowerCase();
    const statBare = bareModelId(statId);
    let matches = keyed.filter((k) => k.exact === statLower);
    if (matches.length === 0) {
      matches = keyed.filter((k) => k.bare === statBare);
    }
    // Ambiguous (two candidates serve the same model id through different providers)
    // or unknown → no opinion. Attaching it to the first match would be a coin flip
    // dressed up as evidence.
    if (matches.length !== 1) {
      continue;
    }
    const key = matches[0].key;
    // A candidate already carrying a stat is not overwritten: two fleet rows folding
    // onto one local candidate is the same ambiguity arriving from the other side.
    if (claimed.has(key)) {
      continue;
    }
    claimed.add(key);
    aligned.push({ ...stat, model: key });
  }
  return aligned;
}
