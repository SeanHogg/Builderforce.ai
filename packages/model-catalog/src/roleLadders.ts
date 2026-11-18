/**
 * Role LADDERS — for the roles where WHICH model leads is a judgement about the model
 * itself (planning, reviewing, writing code), the ordered model FAMILIES that judgement
 * reads, strongest-for-the-role first.
 *
 * WHY DATA, NOT TIER. The catalog tier is a PRICE band. It says Opus costs more than
 * Sonnet; it cannot say Sonnet is the better coder per dollar, or that Kimi K3 outcodes a
 * pricier Grok. Ordering a coding turn by tier put the most expensive model at the head of
 * every coding turn, which is the opposite of the product rule:
 *   • plan / review — the strongest, costlier models (Opus, GPT-5, Kimi K3) judge the work;
 *   • code          — the best coder PER COST: Sonnet before Opus.
 * Cost-first roles (verify, explore, utility) and the balanced chat role have no ladder:
 * the tier/price order already says what they want.
 *
 * WHY FAMILIES. A rung names a model family matched on the BARE id (every routing prefix
 * stripped — `direct/<vendor>/`, `openai-codex/`, `googleai/`, an OpenRouter `<org>/`), so
 * a point release (`claude-sonnet-5` → `claude-sonnet-5-5`) keeps its rung with no edit
 * here. One table, read by every host through the `CatalogView` port. Pure.
 */

/** A model family: a stable name and how its bare id is recognised. */
interface ModelFamily {
  readonly name: string;
  readonly matches: RegExp;
}

/**
 * Every family a ladder names, declared once. Patterns run against the lower-cased
 * {@link ladderModelId}. A Claude id may carry Bedrock's `[<region>.]anthropic.` prefix
 * (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`) — Bedrock ids have no `/` to strip.
 */
const FAMILIES = {
  'claude-opus': { name: 'claude-opus', matches: /^(?:(?:[a-z]{2,4}\.)?anthropic\.)?claude-(?:[\d.-]+-)?opus/ },
  // The legacy Claude 3 Sonnets (`claude-3-sonnet`, `claude-3-5-sonnet`, `claude-3-7-sonnet`)
  // are a generation behind the coder this rung means; they stay off the ladder.
  'claude-sonnet': { name: 'claude-sonnet', matches: /^(?:(?:[a-z]{2,4}\.)?anthropic\.)?claude-(?!3[-.])(?:[\d.-]+-)?sonnet/ },
  // GPT-5 and its Codex line; the small `-mini` / `-nano` cuts are not the flagship.
  'gpt-5': { name: 'gpt-5', matches: /^gpt-5(?![\w.-]*-(?:mini|nano)\b)/ },
  'kimi-k3': { name: 'kimi-k3', matches: /^(?:kimi-)?k3(?:$|[-.])/ },
  'kimi-for-coding': { name: 'kimi-for-coding', matches: /^kimi-for-coding/ },
  // Gemini 2+ Pro; the 1.x Pros are a different class of model.
  'gemini-pro': { name: 'gemini-pro', matches: /^gemini-(?!1[.-])[\w.]+-pro/ },
  // Grok 4 proper; the `-fast` cuts (`grok-4-fast`, `grok-4-1-fast-reasoning`) are not it.
  'grok-4': { name: 'grok-4', matches: /^grok-4(?![\w.-]*-fast\b)/ },
  'qwen-max': { name: 'qwen-max', matches: /^qwen[\w.]*-max/ },
  'minimax-m3': { name: 'minimax-m3', matches: /^minimax-m3/ },
  'minimax-m2': { name: 'minimax-m2', matches: /^minimax-m2(?:$|[-.])/ },
  'muse-spark': { name: 'muse-spark', matches: /^muse-spark/ },
  'gpt-4.1': { name: 'gpt-4.1', matches: /^gpt-4\.1(?![\w.-]*-(?:mini|nano)\b)/ },
} as const satisfies Record<string, ModelFamily>;

type FamilyName = keyof typeof FAMILIES;

/** plan + review: the strongest judges first. */
const STRONGEST: readonly FamilyName[] = [
  'claude-opus', 'gpt-5', 'kimi-k3', 'gemini-pro', 'grok-4', 'qwen-max',
  'claude-sonnet', 'minimax-m3', 'minimax-m2', 'kimi-for-coding', 'muse-spark', 'gpt-4.1',
];

/** code: the best coder per cost first — Sonnet before Opus. */
const CODE: readonly FamilyName[] = [
  'claude-sonnet', 'kimi-k3', 'kimi-for-coding', 'gpt-5', 'minimax-m3', 'minimax-m2', 'qwen-max',
  'claude-opus', 'grok-4', 'gemini-pro', 'muse-spark', 'gpt-4.1',
];

/**
 * Role → its ladder. Keyed by the role NAME (the vocabulary lives in
 * `@builderforce/agent-tools`; this package stays dependency-free). A role absent here
 * has no ladder.
 */
const ROLE_LADDERS: Readonly<Record<string, readonly FamilyName[]>> = {
  plan: STRONGEST,
  review: STRONGEST,
  code: CODE,
};

/**
 * The id a ladder family is matched on: every routing prefix stripped (`direct/<vendor>/`,
 * `openai-codex/`, an OpenRouter `<org>/`), lower-cased — `direct/kimi-code/k3` → `k3`.
 * Not a dispatchable id (an OpenRouter connection's own bare id keeps its `<org>/`). Pure.
 */
export function ladderModelId(model: string): string {
  return model.slice(model.lastIndexOf('/') + 1).toLowerCase();
}

/**
 * The model's rung on the role's ladder — 0 is the lead — or `undefined` when the role has
 * no ladder or the model's family is not on it. Pure.
 */
export function ladderRankOf(role: string | undefined, model: string): number | undefined {
  const ladder = role ? ROLE_LADDERS[role] : undefined;
  if (!ladder) return undefined;
  const bare = ladderModelId(model);
  const rung = ladder.findIndex((family) => FAMILIES[family].matches.test(bare));
  return rung === -1 ? undefined : rung;
}

/**
 * The best (lowest) rung any of `models` holds on the role's ladder, or `undefined` when
 * none is on it. How a PROVIDER is ranked from the models it serves — derived from the
 * ladder, never a second hand-kept provider table. Pure.
 */
export function bestLadderRank(role: string | undefined, models: Iterable<string>): number | undefined {
  let best: number | undefined;
  for (const model of models) {
    const rung = ladderRankOf(role, model);
    if (rung !== undefined && (best === undefined || rung < best)) best = rung;
  }
  return best;
}
