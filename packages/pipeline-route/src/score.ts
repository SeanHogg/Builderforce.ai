/**
 * The pipeline router — does this request need the FULL pipeline (plan → code →
 * verify), or will a QUICK single coding pass do?
 *
 * Every run used to take the full pipeline: an analysis phase that reads the code and
 * hands off, a coding phase, and a verify stage that reviews the change on a different
 * model. For "fix the typo in the README" that is three model tiers and two hand-offs
 * spent on one edit. The router reads the request ONCE, before turn 1, and scores how
 * likely it is to need the whole pipeline.
 *
 * The score is a logistic over a few lexical features, with the weights as data
 * ({@link ROUTE_WEIGHTS}) so they can be tuned — or replaced by a fitted head — without
 * touching a host. `score` is P(full pipeline needed); at or above the threshold the run
 * goes `full`, below it `quick`. `mode: 'always'` keeps every run on the full pipeline
 * (the score is still computed and recorded, so the route report can show what auto
 * WOULD have done), and the words "full pipeline" in the request force it.
 *
 * PURE — no I/O, no env, no clock. The action type is the caller's (the shared lexical
 * classifier in `@builderforce/workload`), so this package depends on nothing.
 */

export type PipelineRoute = 'full' | 'quick';
export type PipelineRoutingMode = 'auto' | 'always';

/** What the router reads about a request. */
export interface PipelineFeatures {
  /** Characters in the request. */
  requestChars: number;
  /** Distinct file paths / file names the request names. */
  fileMentions: number;
  /** A numbered or bulleted list, or chained steps ("then", "after that", "also"). */
  multiStep: boolean;
  /** Breadth words: every, across, entire, codebase, architecture, migrate, … */
  broadScope: boolean;
  /** A question with no change verb — an answer, not a change. */
  questionOnly: boolean;
  /** A continuation of earlier work in the same conversation. */
  followUp: boolean;
  /** The request's action type (`@builderforce/learned-routing` taxonomy), or `other`. */
  actionType: string;
  /** The request says "full pipeline" — the user's own override. */
  forceFull: boolean;
}

/** The weights of the logistic. Positive pulls toward `full`, negative toward `quick`. */
export interface RouteWeights {
  bias: number;
  /** Per decade of request length past {@link LENGTH_FLOOR_CHARS}, clipped to [0, 2] decades. */
  length: number;
  /** Per distinct file named, up to {@link MAX_FILE_MENTIONS}. */
  fileMentions: number;
  multiStep: number;
  broadScope: number;
  questionOnly: number;
  followUp: number;
  /** Per action type; a type not listed contributes 0. */
  actionType: Readonly<Record<string, number>>;
}

/** Below this many characters the length feature contributes nothing. */
export const LENGTH_FLOOR_CHARS = 80;
/** File mentions past this count add nothing more. */
export const MAX_FILE_MENTIONS = 4;
/** The default threshold: a coin. */
export const DEFAULT_ROUTE_THRESHOLD = 0.5;

/**
 * The hand-set weights. Calibrated so a one-line edit ("fix the typo in the README")
 * scores ~0.27 (quick), a single-surface feature ("add a dark mode toggle to settings")
 * sits just under the coin, and a multi-step, broad refactor scores above 0.9 (full).
 * The route report's suggested threshold is how they are re-tuned from real runs.
 */
export const ROUTE_WEIGHTS: RouteWeights = {
  bias: -0.4,
  length: 0.9,
  fileMentions: 0.35,
  multiStep: 1.2,
  broadScope: 1.0,
  questionOnly: -1.3,
  followUp: -0.3,
  actionType: {
    data_migration: 1.0,
    refactor: 0.9,
    provisioning: 0.6,
    backend_api: 0.4,
    decision: 0.3,
    devops_ci: 0.3,
    frontend_ui: 0.2,
    analysis: -0.4,
    docs: -0.6,
  },
};

export interface PipelineScoreOptions {
  /** P(full) at or above which the run takes the full pipeline. Default 0.5; clamped to [0, 1]. */
  threshold?: number;
  /** `always` keeps every run on the full pipeline. Default `auto`. */
  mode?: PipelineRoutingMode;
  weights?: RouteWeights;
}

export interface PipelineScore {
  /** P(the request needs the full pipeline), 0..1. */
  score: number;
  route: PipelineRoute;
  /** Why, in one line — the threshold comparison and the strongest features. */
  reason: string;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The threshold a caller asked for, clamped, or the default for anything not a number. */
export function routeThreshold(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : DEFAULT_ROUTE_THRESHOLD;
}

/** Each feature's contribution to the logit, by name (the bias excluded). */
function contributions(f: PipelineFeatures, w: RouteWeights): Array<[string, number]> {
  const decades = f.requestChars > LENGTH_FLOOR_CHARS ? Math.min(2, Math.log10(f.requestChars / LENGTH_FLOOR_CHARS)) : 0;
  return [
    ['long request', w.length * decades],
    ['files named', w.fileMentions * Math.min(MAX_FILE_MENTIONS, Math.max(0, f.fileMentions))],
    ['multi-step', f.multiStep ? w.multiStep : 0],
    ['broad scope', f.broadScope ? w.broadScope : 0],
    ['question only', f.questionOnly ? w.questionOnly : 0],
    ['follow-up', f.followUp ? w.followUp : 0],
    [f.actionType, w.actionType[f.actionType] ?? 0],
  ];
}

/** THE decision: score the request and pick its route. */
export function scorePipeline(f: PipelineFeatures, opts: PipelineScoreOptions = {}): PipelineScore {
  const w = opts.weights ?? ROUTE_WEIGHTS;
  const threshold = routeThreshold(opts.threshold);
  const parts = contributions(f, w);
  const score = round2(sigmoid(parts.reduce((z, [, c]) => z + c, w.bias)));
  const strongest = parts
    .filter(([, c]) => c !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .map(([name]) => name);
  const why = strongest.length ? ` (${strongest.join(', ')})` : '';
  if (f.forceFull) return { score, route: 'full', reason: `the request asks for the full pipeline; score ${score}${why}` };
  if (opts.mode === 'always') return { score, route: 'full', reason: `routing is set to always; score ${score}${why}` };
  return score >= threshold
    ? { score, route: 'full', reason: `score ${score} ≥ ${threshold}${why}` }
    : { score, route: 'quick', reason: `score ${score} < ${threshold}${why}` };
}

const FILE_RE = /(?:[\w@.-]+\/)+[\w.-]+|\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|cs|php|rb|swift|c|cc|cpp|h|hpp|md|json|ya?ml|toml|sql|css|scss|html|vue|svelte|sh)\b/gi;
const LIST_ITEM_RE = /^\s*(?:\d+[.)]|[-*•])\s+\S/gm;
const CHAIN_RE = /\b(?:and then|then|after that|afterwards|next|also|finally|as well as)\b/gi;
const BROAD_RE = /\b(?:every|each|across|throughout|entire|whole|codebase|repo-?wide|end[- ]to[- ]end|architecture|redesign|overhaul|migrate|migration|all (?:the )?(?:files|modules|services|packages|pages|endpoints|tests|callers|places))\b/i;
const QUESTION_LEAD_RE = /^(?:what|why|how|where|when|which|who|is|are|does|do|did|can|could|should|would|explain|describe|summari[sz]e|show me|tell me)\b/i;
const CHANGE_VERB_RE = /\b(?:add|implement|create|build|fix|change|refactor|update|remove|delete|rename|write|migrate|make|move|replace|convert|upgrade|bump|wire|port)\b/i;
const FORCE_FULL_RE = /\bfull[- ]pipeline\b/i;

/**
 * The request's features, read lexically. `actionType` is the caller's classification
 * (`classifyRunAction` in `@builderforce/workload`); `followUp` whether the request
 * continues earlier work in the conversation.
 */
export function pipelineFeaturesOf(
  request: string,
  context: { actionType?: string; followUp?: boolean } = {},
): PipelineFeatures {
  const text = request.trim();
  const files = new Set((text.match(FILE_RE) ?? []).map((m) => m.toLowerCase()));
  const listItems = (text.match(LIST_ITEM_RE) ?? []).length;
  const chained = (text.match(CHAIN_RE) ?? []).length;
  const asks = text.endsWith('?') || QUESTION_LEAD_RE.test(text);
  return {
    requestChars: text.length,
    fileMentions: files.size,
    multiStep: listItems >= 2 || chained >= 2,
    broadScope: BROAD_RE.test(text),
    questionOnly: asks && !CHANGE_VERB_RE.test(text),
    followUp: context.followUp === true,
    actionType: context.actionType ?? 'other',
    forceFull: FORCE_FULL_RE.test(text),
  };
}
