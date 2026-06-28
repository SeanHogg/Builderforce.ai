/**
 * Psychometric persona engine (Pro feature).
 *
 * A persona can carry a {@link PsychometricProfile} — a structured trait vector
 * derived from validated psychological frameworks (HEXACO, Regulatory Focus,
 * Need-for-Cognition, decision style, Moral Foundations, Thomas-Kilmann conflict,
 * Schwartz values, Enneagram, plus dispositional traits). The profile is what
 * gives an agent a *personality*: it changes not just tone but how the agent
 * actually executes.
 *
 * This module is the deterministic **compiler**. It is the single point where a
 * trait vector becomes behaviour:
 *
 *   compilePsychometricProfile(profile) -> { directives, params }
 *
 *   • `directives` are system-prompt lines (injected by buildPersonaSystemBlock)
 *   • `params`     are execution levers (thinkLevel / reasoningLevel / temperature)
 *
 * Emitting BOTH is the whole point — without the param half, "high
 * Conscientiousness" would be flavour text that never makes the agent plan more.
 *
 * --- Cross-package contract ---
 * The catalog the UI renders (framework names, dimension labels, the
 * questionnaire bank, server-side scoring, persistence, and the Pro gate) lives
 * in the `api` package, which serves it to the frontend. THIS file owns only the
 * behavioural semantics (vector -> directives + params). The two sides are
 * coupled solely by the dimension-id strings in {@link DIM}. Keep them in sync.
 */
import { PSYCH_DIM, type AgentExecParams } from "@builderforce/agent-tools";
import type { ThinkLevel } from "../auto-reply/thinking.js";
import type { AgentRole } from "./types.js";

// ---------------------------------------------------------------------------
// Trait vector model
// ---------------------------------------------------------------------------

/**
 * Canonical dimension ids — re-exported from the single shared map
 * (`@builderforce/agent-tools` PSYCH_DIM), the same one the api catalog and the
 * limbic setpoint derivation read. Every score in a profile vector is keyed by
 * one of these; scores are 0..100, an absent dimension is neutral (50).
 */
export const DIM = PSYCH_DIM;

export type DimensionId = (typeof DIM)[keyof typeof DIM];

/** A persona's psychometric makeup. Attached to {@link AgentPersona}. */
export type PsychometricProfile = {
  /** dimension-id -> 0..100 score. Absent dimension = neutral (50). */
  vector: Record<string, number>;
  /** Optional Enneagram core type (1..9) — typological, drives core motivation. */
  enneagramType?: number;
  /** Optional MBTI 4-letter code — a relatability skin, not behaviour-bearing. */
  mbti?: string;
  /** Framework ids the author opted into (informational, for the editor). */
  frameworks?: string[];
  /** Provenance of the vector. */
  source?: "sliders" | "questionnaire" | "imported";
  notes?: string;
};

/**
 * Execution levers a profile can nudge. All optional — only set when signalled.
 * Aliased to the canonical {@link AgentExecParams} from `@builderforce/agent-tools`
 * so the trait compiler, the limbic compiler, and the {@link AgentSpec} lowering
 * all speak one exec-param type (no per-package redefinition).
 */
export type PsychometricExecParams = AgentExecParams;

export type CompiledPsychometrics = {
  directives: string[];
  params: PsychometricExecParams;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HI = 65; // score at/above which a "high" directive fires
const LO = 35; // score at/below which a "low" directive fires
const NEUTRAL = 50;

function score(vector: Record<string, number>, id: string): number {
  const raw = vector[id];
  if (typeof raw !== "number" || Number.isNaN(raw)) return NEUTRAL;
  return Math.max(0, Math.min(100, raw));
}

const THINK_ORDER: ThinkLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
function maxThink(a: ThinkLevel | undefined, b: ThinkLevel): ThinkLevel {
  if (!a) return b;
  return THINK_ORDER.indexOf(a) >= THINK_ORDER.indexOf(b) ? a : b;
}

/**
 * Treat a persona's think level as a *floor* on the requested one: personality may
 * deepen deliberation but never reduce it below what the operator asked for.
 * Returns the requested level when the persona contributes nothing.
 */
export function raiseThinkLevel(
  requested: ThinkLevel | undefined,
  floor: ThinkLevel | undefined,
): ThinkLevel | undefined {
  if (!floor) return requested;
  if (!requested) return floor;
  return maxThink(requested, floor);
}

const ENNEAGRAM_MOTIVATION: Record<number, string> = {
  1: "Core drive: be correct and principled — avoid mistakes and sloppiness; hold work to a high standard.",
  2: "Core drive: be helpful and needed — anticipate what others require and support the team.",
  3: "Core drive: achieve and be effective — optimise for visible results and momentum.",
  4: "Core drive: be authentic and distinctive — favour original, considered solutions over rote ones.",
  5: "Core drive: understand deeply — gather sufficient information and reason before committing.",
  6: "Core drive: be secure and prepared — anticipate failure modes and build in safeguards.",
  7: "Core drive: explore options and keep momentum — stay flexible and avoid getting stuck.",
  8: "Core drive: take charge and protect — act decisively and own outcomes directly.",
  9: "Core drive: keep things stable and harmonious — reduce friction and find common ground.",
};

// ---------------------------------------------------------------------------
// The compiler: vector -> { directives, params }
// ---------------------------------------------------------------------------

/**
 * Compile a psychometric profile into behaviour. Pure and deterministic — same
 * profile always yields the same directives and params, so it is unit-testable
 * and safe to memoise.
 */
export function compilePsychometricProfile(profile: PsychometricProfile): CompiledPsychometrics {
  const v = profile.vector ?? {};
  const directives: string[] = [];
  const params: PsychometricExecParams = {};

  // Temperature accumulates around a 0.6 baseline; only emitted if something moved it.
  let temp = 0.6;
  let tempMoved = false;
  const nudgeTemp = (delta: number) => {
    temp += delta;
    tempMoved = true;
  };

  // --- HEXACO spine -------------------------------------------------------
  const consc = score(v, DIM.conscientiousness);
  if (consc >= HI) {
    directives.push(
      "Conscientiousness: plan before acting, work methodically, write and run tests, and double-check before declaring anything done.",
    );
    params.thinkLevel = maxThink(params.thinkLevel, "high");
  } else if (consc <= LO) {
    directives.push("Conscientiousness: bias to action — keep things lightweight and avoid over-process.");
  }

  const open = score(v, DIM.openness);
  if (open >= HI) {
    directives.push("Openness: explore novel approaches and unconventional ideas before settling on the obvious one.");
    nudgeTemp(+0.15);
  } else if (open <= LO) {
    directives.push("Openness: prefer proven, conventional patterns over novel experiments.");
    nudgeTemp(-0.15);
  }

  const emo = score(v, DIM.emotionality);
  if (emo >= HI) {
    directives.push("Emotionality: surface risks and uncertainties early, and escalate when genuinely unsure rather than guessing.");
  } else if (emo <= LO) {
    directives.push("Emotionality: stay calm under ambiguity — avoid over-escalating; only flag material risks.");
  }

  const extra = score(v, DIM.extraversion);
  if (extra >= HI) {
    directives.push("Extraversion: be proactive and communicative — volunteer progress and options.");
  } else if (extra <= LO) {
    directives.push("Extraversion: be concise — act first, narrate only what matters.");
  }

  const agree = score(v, DIM.agreeableness);
  if (agree >= HI) {
    directives.push("Agreeableness: seek consensus and accommodate others' constraints where reasonable.");
  } else if (agree <= LO) {
    directives.push("Agreeableness: push back directly and challenge weak reasoning rather than deferring.");
  }

  // Honesty-Humility only ever emits a positive (anti-sycophancy) directive.
  if (score(v, DIM.honesty) >= HI) {
    directives.push(
      "Honesty-Humility: never fabricate, admit uncertainty plainly, resist sycophancy, and refuse to overstate results even when asked.",
    );
  }

  // --- Regulatory focus ---------------------------------------------------
  const reg = score(v, DIM.regulatoryFocus);
  if (reg >= HI) {
    directives.push("Regulatory focus (promotion): optimise for opportunity and speed; accept calculated, reversible risk to move faster.");
    nudgeTemp(+0.1);
  } else if (reg <= LO) {
    directives.push("Regulatory focus (prevention): optimise for safety and correctness; add guardrails and avoid errors over chasing upside.");
    nudgeTemp(-0.1);
    params.thinkLevel = maxThink(params.thinkLevel, "medium");
  }

  // --- Cognition / dual-process ------------------------------------------
  const nfc = score(v, DIM.needForCognition);
  if (nfc >= HI) {
    directives.push("Cognition: reason step-by-step and analyse deeply before concluding; show your working on hard problems.");
    params.thinkLevel = maxThink(params.thinkLevel, "high");
    params.reasoningLevel = "on";
  } else if (nfc <= LO) {
    directives.push("Cognition: trust pattern-matching and act decisively; do not over-analyse routine work.");
    params.thinkLevel = maxThink(params.thinkLevel, "low");
  }
  if (score(v, DIM.reflection) >= HI) {
    directives.push("Reflection: distrust the first intuitive answer — verify your reasoning before acting on it.");
  }

  // --- Decision style -----------------------------------------------------
  if (score(v, DIM.decisionRational) >= HI)
    directives.push("Decision style: decide analytically, making trade-offs explicit.");
  if (score(v, DIM.decisionIntuitive) >= HI)
    directives.push("Decision style: trust well-earned intuition when evidence is thin.");
  if (score(v, DIM.decisionDependent) >= HI)
    directives.push("Decision style: seek input or confirmation from a human or peer before committing to consequential choices.");
  if (score(v, DIM.decisionSpontaneous) >= HI)
    directives.push("Decision style: decide quickly and keep momentum; do not belabour reversible calls.");

  const maxim = score(v, DIM.maximizing);
  if (maxim >= HI) {
    directives.push("Thoroughness: compare alternatives and optimise before settling — aim for the best option, not the first workable one.");
  } else if (maxim <= LO) {
    directives.push("Thoroughness: stop at good-enough; do not gold-plate or over-polish working solutions.");
  }

  // --- Moral Foundations (governance priors) -----------------------------
  const moral: Array<[string, number, string]> = [
    ["care", score(v, DIM.moralCare), "prioritise user wellbeing and avoid harm"],
    ["fairness", score(v, DIM.moralFairness), "treat stakeholders equitably and proportionately"],
    ["loyalty", score(v, DIM.moralLoyalty), "protect the team's and project's interests"],
    ["authority", score(v, DIM.moralAuthority), "respect established policy and ownership boundaries"],
    ["sanctity", score(v, DIM.moralSanctity), "uphold code, data, and process integrity"],
    ["liberty", score(v, DIM.moralLiberty), "preserve user autonomy and avoid over-constraining"],
  ];
  const strongMoral = moral.filter(([, s]) => s >= HI).map(([, , phrase]) => phrase);
  if (strongMoral.length > 0) {
    directives.push(`Values lens: when resolving trade-offs, ${strongMoral.join("; ")}.`);
  }

  // --- Thomas-Kilmann conflict mode (derived from two axes) --------------
  // Only emit a mode when at least one axis is actually engaged — an untouched
  // (neutral) pair must produce nothing.
  const assertive = score(v, DIM.conflictAssertiveness);
  const coop = score(v, DIM.conflictCooperativeness);
  if (assertive !== NEUTRAL || coop !== NEUTRAL) {
    if (assertive >= HI && coop >= HI)
      directives.push("Conflict mode (collaborating): in disagreement, integrate views and seek a win-win.");
    else if (assertive >= HI && coop <= LO)
      directives.push("Conflict mode (competing): stand firm on your position when you are confident it is right.");
    else if (assertive <= LO && coop >= HI)
      directives.push("Conflict mode (accommodating): yield to others' preferences to preserve a working relationship.");
    else if (assertive <= LO && coop <= LO)
      directives.push("Conflict mode (avoiding): sidestep low-value conflicts and pick your battles.");
    else directives.push("Conflict mode (compromising): look for a fair middle ground when views differ.");
  }

  // --- Schwartz values (top priorities) ----------------------------------
  const values: Array<[string, number]> = [
    ["self-direction", score(v, DIM.valSelfDirection)],
    ["stimulation", score(v, DIM.valStimulation)],
    ["hedonism", score(v, DIM.valHedonism)],
    ["achievement", score(v, DIM.valAchievement)],
    ["power", score(v, DIM.valPower)],
    ["security", score(v, DIM.valSecurity)],
    ["conformity", score(v, DIM.valConformity)],
    ["tradition", score(v, DIM.valTradition)],
    ["benevolence", score(v, DIM.valBenevolence)],
    ["universalism", score(v, DIM.valUniversalism)],
  ];
  const topValues = values
    .filter(([, s]) => s >= HI)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
  if (topValues.length > 0) {
    directives.push(`Guiding values: prioritise ${topValues.join(", ")} when goals conflict.`);
  }

  // --- Dispositional ------------------------------------------------------
  const grit = score(v, DIM.grit);
  if (grit >= HI)
    directives.push("Grit: persist through obstacles — retry intelligently and exhaust reasonable approaches before giving up or escalating.");
  else if (grit <= LO)
    directives.push("Grit: if an approach stalls, escalate or ask for direction rather than grinding.");

  if (score(v, DIM.locusInternal) >= HI)
    directives.push("Ownership: treat outcomes as within your control — own failures and drive them to resolution.");

  const risk = score(v, DIM.riskTolerance);
  if (risk >= HI) {
    directives.push("Risk: accept calculated risks for speed, but keep changes reversible.");
    nudgeTemp(+0.1);
  } else if (risk <= LO) {
    directives.push("Risk: prefer safe, reversible steps and confirm before any destructive or hard-to-undo action.");
    nudgeTemp(-0.1);
  }

  // --- Enneagram core motivation -----------------------------------------
  if (typeof profile.enneagramType === "number" && ENNEAGRAM_MOTIVATION[profile.enneagramType]) {
    directives.push(ENNEAGRAM_MOTIVATION[profile.enneagramType]);
  }

  if (tempMoved) {
    params.temperature = Math.round(Math.max(0.1, Math.min(1.0, temp)) * 100) / 100;
  }

  return { directives, params };
}

/**
 * Render a profile's directives as a system-prompt sub-block. Returns '' when the
 * profile produces no directives (e.g. a fully neutral vector).
 */
export function buildPsychometricBlock(profile: PsychometricProfile | undefined): string {
  if (!profile) return "";
  const { directives } = compilePsychometricProfile(profile);
  if (directives.length === 0) return "";
  return ["Personality (execute under these traits):", ...directives.map((d) => `- ${d}`)].join("\n");
}

// ---------------------------------------------------------------------------
// Aggregation across active personas (for the execution path)
// ---------------------------------------------------------------------------

/**
 * Merge the execution params of several profiles into one. thinkLevel takes the
 * strongest signal, reasoningLevel turns on if any asks for it, temperature is
 * averaged across those that set one. Used to derive run-level overrides from all
 * personas active on an agent.
 */
export function mergeExecParams(profiles: PsychometricProfile[]): PsychometricExecParams {
  const merged: PsychometricExecParams = {};
  const temps: number[] = [];
  for (const profile of profiles) {
    const { params } = compilePsychometricProfile(profile);
    if (params.thinkLevel) merged.thinkLevel = maxThink(merged.thinkLevel, params.thinkLevel);
    if (params.reasoningLevel === "on") merged.reasoningLevel = "on";
    if (typeof params.temperature === "number") temps.push(params.temperature);
  }
  if (temps.length > 0) {
    merged.temperature = Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 100) / 100;
  }
  return merged;
}

/** Extract the psychometric profile carried by a role's persona, if any. */
export function getRoleProfile(role: AgentRole): PsychometricProfile | undefined {
  return role.persona?.psychometric;
}
