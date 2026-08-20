/**
 * Learned Model Routing (PRD 13) — the on-prem ACTION-TYPE classifier.
 *
 * Labels a run with one {@link ActionType} from the SHARED taxonomy
 * (`@builderforce/learned-routing`) — the same closed vocabulary the cloud
 * classifier, the routing blob, the analytics endpoint and the ratings rollup use.
 * The taxonomy is imported, never restated: a bucket this host invented would land
 * in `normalizeActionType`'s `other` on the way into the ledger and quietly teach
 * the fleet nothing.
 *
 * ── WHY LEXICAL AND NOT AN LLM CALL ──────────────────────────────────────────
 * The cloud classifier (`api/src/application/llm/classifyTask.ts`) spends a free-pool
 * completion per TASK and caches the verdict on `tasks.action_type`, so its cost
 * amortizes across every re-run of that ticket. This host has neither half of that
 * bargain: an embedded run is a prompt, not a durable ticket row, so there is nothing
 * to cache the verdict ON, and the call would repeat for every turn — paying latency
 * on the critical path of a run whose whole point is that it executes locally.
 *
 * So the label is derived lexically from the prompt. That is weaker, and the design
 * accounts for it honestly: a low-confidence verdict resolves to `other` rather than
 * guessing, because a WRONG bucket is worse than the fallback one — it credits a
 * model's success to work it never did, and that lie outlives the run by the full
 * 60-day routing window. `other` is a real bucket that ranks correctly; a mislabel
 * is corruption.
 *
 * PURE — no I/O, no env, no clock. Every branch is unit-testable.
 */

import { DEFAULT_ACTION_TYPE, type ActionType } from "@builderforce/learned-routing";

export interface ActionClassification {
  actionType: ActionType;
  /** 0..1 — the winning bucket's share of all matched evidence. */
  confidence: number;
}

/**
 * Minimum share of the matched evidence the winner must hold before the label is
 * trusted. Below it the run is labelled `other`: a prompt that reads equally like a
 * refactor and a bugfix carries no usable routing signal, and inventing one poisons
 * two buckets instead of leaving one honest.
 */
export const MIN_CONFIDENCE = 0.45;

/** Cap on how much of the prompt is read as the INSTRUCTION — scored at full weight.
 *  The instruction ends at the first PARAGRAPH BREAK when there is one before the cap,
 *  because that is where an agent prompt stops asking and starts pasting. */
export const INSTRUCTION_CHARS = 600;

/** How much of the rest is read as CONTEXT — scored, but discounted. */
export const CONTEXT_CHARS = 2_000;

/** The discount applied to a signal that only appears in the context tail. */
export const CONTEXT_WEIGHT = 0.5;

/** A weighted lexical signal for one bucket. Weight 2 marks a term that is close to
 *  decisive on its own; weight 1 marks a term that only counts alongside others. */
type Signal = { re: RegExp; weight: number };

const sig = (source: string, weight = 1): Signal => ({
  re: new RegExp(source, "i"),
  weight,
});

/**
 * The evidence table. Ordering inside a bucket is irrelevant (all signals are summed);
 * ordering BETWEEN buckets breaks exact ties, so the more specific kinds of work are
 * listed before the broader ones — `data_migration` before `sql`, `tests` before
 * `bugfix` — and `other` is never scored, only defaulted to.
 */
const SIGNALS: ReadonlyArray<readonly [ActionType, readonly Signal[]]> = [
  [
    "data_migration",
    [
      sig("\\bbackfill(ing|ed)?\\b", 2),
      sig("\\bdata migration\\b", 2),
      sig("\\bre-?index(ing)?\\b"),
      sig("\\bmigrate .{0,20}\\bdata\\b", 2),
      sig("\\bseed (the )?(database|table|data)\\b", 2),
      sig("\\betl\\b", 2),
    ],
  ],
  [
    "sql",
    [
      sig("\\bsql\\b", 2),
      sig("\\bquery\\b"),
      sig("\\bschema\\b"),
      sig("\\bmigration\\b"),
      sig("\\bpostgres|postgresql|sqlite|mysql\\b", 2),
      sig("\\bcreate table|alter table|drop table\\b", 2),
      sig("\\bindex(es)? on\\b"),
      sig("\\bforeign key|primary key\\b", 2),
    ],
  ],
  [
    "tests",
    [
      sig("\\bunit test|integration test|e2e test\\b", 2),
      sig("\\btests?\\b"),
      sig("\\bvitest|jest|pytest|playwright|mocha\\b", 2),
      sig("\\btest coverage\\b", 2),
      sig("\\bassert(ion)?s?\\b"),
      sig("\\bspec file\\b", 2),
    ],
  ],
  [
    "docs",
    [
      sig("\\bdocument(ation)?\\b", 2),
      sig("\\breadme\\b", 2),
      sig("\\bchangelog\\b", 2),
      sig("\\bdocstring|jsdoc|tsdoc\\b", 2),
      sig("\\bwrite .{0,20}\\bguide\\b", 2),
      sig("\\bcomment(s|ing)?\\b"),
    ],
  ],
  [
    "devops_ci",
    [
      sig("\\bci\\b|\\bcd\\b", 2),
      sig("\\bgithub actions?|gitlab ci|jenkins|circleci\\b", 2),
      sig("\\bdocker(file)?|kubernetes|k8s|helm\\b", 2),
      sig("\\bdeploy(ment|ing)?\\b"),
      sig("\\bpipeline\\b"),
      sig("\\bbuild (script|config|failure)\\b", 2),
      sig("\\bterraform|ansible\\b", 2),
    ],
  ],
  [
    "provisioning",
    [
      sig("\\bprovision(ing|ed)?\\b", 2),
      sig("\\bspin up\\b", 2),
      sig("\\bcreate (a|an|the) (bucket|cluster|queue|instance|database|namespace)\\b", 2),
      sig("\\bdns|certificate|tls cert\\b"),
      sig("\\bconfigure .{0,20}\\b(account|tenant|workspace|environment)\\b"),
    ],
  ],
  [
    "frontend_ui",
    [
      sig("\\bui\\b|\\bux\\b", 2),
      sig("\\bcomponent\\b"),
      sig("\\breact|vue|svelte|angular\\b", 2),
      sig("\\bcss|tailwind|stylesheet|styling\\b", 2),
      sig("\\bbutton|modal|dropdown|layout|page\\b"),
      sig("\\bresponsive|dark mode|accessib(le|ility)\\b", 2),
      sig("\\bfront-?end\\b", 2),
    ],
  ],
  [
    "backend_api",
    [
      sig("\\bapi\\b", 2),
      sig("\\bendpoint|route handler\\b", 2),
      sig("\\brest|graphql|grpc\\b", 2),
      sig("\\bback-?end\\b", 2),
      sig("\\bservice layer|controller|middleware\\b", 2),
      sig("\\bserver\\b"),
      sig("\\bauth(entication|orization)?\\b"),
    ],
  ],
  [
    "refactor",
    [
      sig("\\brefactor(ing|ed)?\\b", 2),
      sig("\\bclean ?up\\b", 2),
      sig("\\bextract (a |the )?(function|method|component|module|helper)\\b", 2),
      sig("\\brename\\b"),
      sig("\\bdeduplicat|\\bdry\\b", 2),
      sig("\\brestructure|reorganis|reorganiz\\b", 2),
      sig("\\bsimplify\\b"),
    ],
  ],
  [
    "bugfix",
    [
      sig("\\bbug\\b", 2),
      sig("\\bfix(es|ed|ing)?\\b", 2),
      sig("\\bbroken|crash(es|ing)?|regression\\b", 2),
      sig("\\berror\\b"),
      sig("\\bstack ?trace|exception\\b", 2),
      sig("\\bnot working|fails? to\\b", 2),
      sig("\\bdebug(ging)?\\b"),
    ],
  ],
  [
    "analysis",
    [
      sig("\\banalys|analyz\\b", 2),
      sig("\\binvestigate|investigation\\b", 2),
      sig("\\bresearch\\b", 2),
      sig("\\bexplain|summaris|summariz\\b"),
      sig("\\bwhy (does|is|did|are)\\b", 2),
      sig("\\baudit|assess(ment)?\\b", 2),
      sig("\\bcompare\\b"),
    ],
  ],
  [
    "decision",
    [
      sig("\\bapprove|approval\\b", 2),
      sig("\\bshould we\\b", 2),
      sig("\\bdecide|decision\\b", 2),
      sig("\\bsign ?off\\b", 2),
      sig("\\bchoose between\\b", 2),
    ],
  ],
];

/**
 * Label a run's prompt with one action type. Returns `other` at confidence 0 for
 * empty input or evidence too thin/too split to trust. PURE.
 */
export function classifyRunAction(prompt: string | undefined | null): ActionClassification {
  const text = (prompt ?? "").trim();
  if (!text) {
    return { actionType: DEFAULT_ACTION_TYPE, confidence: 0 };
  }
  // An agent prompt is an instruction followed by pasted files, transcripts and tool
  // output whose vocabulary describes the CODEBASE, not the work being asked for. Read
  // flat, that bulk decides every label — a repository full of SQL makes every run
  // `sql`. So the instruction is scored at full weight and the context tail at a
  // discount: it still breaks a tie, and it can no longer win one outright.
  const paragraphBreak = text.indexOf("\n\n");
  const instructionEnd =
    paragraphBreak > 0 ? Math.min(paragraphBreak, INSTRUCTION_CHARS) : INSTRUCTION_CHARS;
  const instruction = text.slice(0, instructionEnd);
  const context = text.slice(instructionEnd, CONTEXT_CHARS);

  let total = 0;
  let best: { actionType: ActionType; score: number } | null = null;
  for (const [actionType, signals] of SIGNALS) {
    let score = 0;
    for (const s of signals) {
      if (s.re.test(instruction)) {
        score += s.weight;
      } else if (context && s.re.test(context)) {
        score += s.weight * CONTEXT_WEIGHT;
      }
    }
    total += score;
    if (score > 0 && (best === null || score > best.score)) {
      best = { actionType, score };
    }
  }

  if (!best || total === 0) {
    return { actionType: DEFAULT_ACTION_TYPE, confidence: 0 };
  }
  const confidence = best.score / total;
  if (confidence < MIN_CONFIDENCE) {
    return { actionType: DEFAULT_ACTION_TYPE, confidence };
  }
  return { actionType: best.actionType, confidence };
}
