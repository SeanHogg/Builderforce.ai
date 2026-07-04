/**
 * Psychometric personality compiler (shared, dependency-free).
 *
 * **This is the single, shared source** for turning a psychometric trait vector
 * into behaviour, consumed by every agent surface so they all execute a persona
 * the same way:
 *   • on-prem agent-runtime (embedded runner + Claude-Agent-SDK engine),
 *   • the cloud engine (`api` — cloud tenant agents), and
 *   • the VS Code extension's built-in agent.
 *
 * A persona can carry a {@link LimbicPsychProfile} — a structured trait vector
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
 *   • `directives` are system-prompt lines (rendered by buildPsychometricBlock)
 *   • `params`     are execution levers (thinkLevel / reasoningLevel / temperature)
 *
 * Emitting BOTH is the whole point — without the param half, "high
 * Conscientiousness" would be flavour text that never makes the agent plan more.
 *
 * The static counterpart of the dynamic limbic layer ({@link ./limbic.js}):
 * personality = homeostatic setpoints, limbic = the live deviation. Pure and
 * deterministic (no GPU, no I/O) so it is unit-testable and runs in a Cloudflare
 * Worker, Node, and a VS Code extension alike. The only cross-system contract is
 * the psychometric dimension-id strings in {@link PSYCH_DIM}.
 */
import { PSYCH_DIM } from "./psychometric-dims.js";
// HI/LO/NEUTRAL thresholds + the trait scorer are the single shared source in limbic.
import { maxThink, HI, LO, NEUTRAL, score, type LimbicPsychProfile } from "./limbic.js";
import { bulletBlock, PERSONA_BLOCK_HEADER, type AgentExecParams } from "./spec.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

export type CompiledPsychometrics = {
  directives: string[];
  params: AgentExecParams;
};

// ---------------------------------------------------------------------------
// The compiler: vector -> { directives, params }
// ---------------------------------------------------------------------------

/**
 * Compile a psychometric profile into behaviour. Pure and deterministic — same
 * profile always yields the same directives and params, so it is unit-testable
 * and safe to memoise.
 */
export function compilePsychometricProfile(profile: LimbicPsychProfile): CompiledPsychometrics {
  const v = profile.vector ?? {};
  const directives: string[] = [];
  const params: AgentExecParams = {};

  // Temperature accumulates around a 0.6 baseline; only emitted if something moved it.
  let temp = 0.6;
  let tempMoved = false;
  const nudgeTemp = (delta: number) => {
    temp += delta;
    tempMoved = true;
  };

  // --- HEXACO spine -------------------------------------------------------
  const consc = score(v, PSYCH_DIM.conscientiousness);
  if (consc >= HI) {
    directives.push(
      "Conscientiousness: plan before acting, work methodically, write and run tests, and double-check before declaring anything done.",
    );
    params.thinkLevel = maxThink(params.thinkLevel, "high");
  } else if (consc <= LO) {
    directives.push("Conscientiousness: bias to action — keep things lightweight and avoid over-process.");
  }

  const open = score(v, PSYCH_DIM.openness);
  if (open >= HI) {
    directives.push("Openness: explore novel approaches and unconventional ideas before settling on the obvious one.");
    nudgeTemp(+0.15);
  } else if (open <= LO) {
    directives.push("Openness: prefer proven, conventional patterns over novel experiments.");
    nudgeTemp(-0.15);
  }

  const emo = score(v, PSYCH_DIM.emotionality);
  if (emo >= HI) {
    directives.push("Emotionality: surface risks and uncertainties early, and escalate when genuinely unsure rather than guessing.");
  } else if (emo <= LO) {
    directives.push("Emotionality: stay calm under ambiguity — avoid over-escalating; only flag material risks.");
  }

  const extra = score(v, PSYCH_DIM.extraversion);
  if (extra >= HI) {
    directives.push("Extraversion: be proactive and communicative — volunteer progress and options.");
  } else if (extra <= LO) {
    directives.push("Extraversion: be concise — act first, narrate only what matters.");
  }

  const agree = score(v, PSYCH_DIM.agreeableness);
  if (agree >= HI) {
    directives.push("Agreeableness: seek consensus and accommodate others' constraints where reasonable.");
  } else if (agree <= LO) {
    directives.push("Agreeableness: push back directly and challenge weak reasoning rather than deferring.");
  }

  // Honesty-Humility only ever emits a positive (anti-sycophancy) directive.
  if (score(v, PSYCH_DIM.honesty) >= HI) {
    directives.push(
      "Honesty-Humility: never fabricate, admit uncertainty plainly, resist sycophancy, and refuse to overstate results even when asked.",
    );
  }

  // --- Regulatory focus ---------------------------------------------------
  const reg = score(v, PSYCH_DIM.regulatoryFocus);
  if (reg >= HI) {
    directives.push("Regulatory focus (promotion): optimise for opportunity and speed; accept calculated, reversible risk to move faster.");
    nudgeTemp(+0.1);
  } else if (reg <= LO) {
    directives.push("Regulatory focus (prevention): optimise for safety and correctness; add guardrails and avoid errors over chasing upside.");
    nudgeTemp(-0.1);
    params.thinkLevel = maxThink(params.thinkLevel, "medium");
  }

  // --- Cognition / dual-process ------------------------------------------
  const nfc = score(v, PSYCH_DIM.needForCognition);
  if (nfc >= HI) {
    directives.push("Cognition: reason step-by-step and analyse deeply before concluding; show your working on hard problems.");
    params.thinkLevel = maxThink(params.thinkLevel, "high");
    params.reasoningLevel = "on";
  } else if (nfc <= LO) {
    directives.push("Cognition: trust pattern-matching and act decisively; do not over-analyse routine work.");
    params.thinkLevel = maxThink(params.thinkLevel, "low");
  }
  if (score(v, PSYCH_DIM.reflection) >= HI) {
    directives.push("Reflection: distrust the first intuitive answer — verify your reasoning before acting on it.");
  }

  // --- Decision style -----------------------------------------------------
  if (score(v, PSYCH_DIM.decisionRational) >= HI)
    directives.push("Decision style: decide analytically, making trade-offs explicit.");
  if (score(v, PSYCH_DIM.decisionIntuitive) >= HI)
    directives.push("Decision style: trust well-earned intuition when evidence is thin.");
  if (score(v, PSYCH_DIM.decisionDependent) >= HI)
    directives.push("Decision style: seek input or confirmation from a human or peer before committing to consequential choices.");
  if (score(v, PSYCH_DIM.decisionSpontaneous) >= HI)
    directives.push("Decision style: decide quickly and keep momentum; do not belabour reversible calls.");

  const maxim = score(v, PSYCH_DIM.maximizing);
  if (maxim >= HI) {
    directives.push("Thoroughness: compare alternatives and optimise before settling — aim for the best option, not the first workable one.");
  } else if (maxim <= LO) {
    directives.push("Thoroughness: stop at good-enough; do not gold-plate or over-polish working solutions.");
  }

  // --- Moral Foundations (governance priors) -----------------------------
  const moral: Array<[string, number, string]> = [
    ["care", score(v, PSYCH_DIM.moralCare), "prioritise user wellbeing and avoid harm"],
    ["fairness", score(v, PSYCH_DIM.moralFairness), "treat stakeholders equitably and proportionately"],
    ["loyalty", score(v, PSYCH_DIM.moralLoyalty), "protect the team's and project's interests"],
    ["authority", score(v, PSYCH_DIM.moralAuthority), "respect established policy and ownership boundaries"],
    ["sanctity", score(v, PSYCH_DIM.moralSanctity), "uphold code, data, and process integrity"],
    ["liberty", score(v, PSYCH_DIM.moralLiberty), "preserve user autonomy and avoid over-constraining"],
  ];
  const strongMoral = moral.filter(([, s]) => s >= HI).map(([, , phrase]) => phrase);
  if (strongMoral.length > 0) {
    directives.push(`Values lens: when resolving trade-offs, ${strongMoral.join("; ")}.`);
  }

  // --- Thomas-Kilmann conflict mode (derived from two axes) --------------
  // Only emit a mode when at least one axis is actually engaged — an untouched
  // (neutral) pair must produce nothing.
  const assertive = score(v, PSYCH_DIM.conflictAssertiveness);
  const coop = score(v, PSYCH_DIM.conflictCooperativeness);
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
    ["self-direction", score(v, PSYCH_DIM.valSelfDirection)],
    ["stimulation", score(v, PSYCH_DIM.valStimulation)],
    ["hedonism", score(v, PSYCH_DIM.valHedonism)],
    ["achievement", score(v, PSYCH_DIM.valAchievement)],
    ["power", score(v, PSYCH_DIM.valPower)],
    ["security", score(v, PSYCH_DIM.valSecurity)],
    ["conformity", score(v, PSYCH_DIM.valConformity)],
    ["tradition", score(v, PSYCH_DIM.valTradition)],
    ["benevolence", score(v, PSYCH_DIM.valBenevolence)],
    ["universalism", score(v, PSYCH_DIM.valUniversalism)],
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
  const grit = score(v, PSYCH_DIM.grit);
  if (grit >= HI)
    directives.push("Grit: persist through obstacles — retry intelligently and exhaust reasonable approaches before giving up or escalating.");
  else if (grit <= LO)
    directives.push("Grit: if an approach stalls, escalate or ask for direction rather than grinding.");

  if (score(v, PSYCH_DIM.locusInternal) >= HI)
    directives.push("Ownership: treat outcomes as within your control — own failures and drive them to resolution.");

  const risk = score(v, PSYCH_DIM.riskTolerance);
  if (risk >= HI) {
    directives.push("Risk: accept calculated risks for speed, but keep changes reversible.");
    nudgeTemp(+0.1);
  } else if (risk <= LO) {
    directives.push("Risk: prefer safe, reversible steps and confirm before any destructive or hard-to-undo action.");
    nudgeTemp(-0.1);
  }

  // --- Enneagram core motivation -----------------------------------------
  if (typeof profile.enneagramType === "number" && ENNEAGRAM_MOTIVATION[profile.enneagramType]) {
    directives.push(ENNEAGRAM_MOTIVATION[profile.enneagramType]!);
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
export function buildPsychometricBlock(profile: LimbicPsychProfile | undefined): string {
  if (!profile) return "";
  const { directives } = compilePsychometricProfile(profile);
  if (directives.length === 0) return "";
  return bulletBlock(PERSONA_BLOCK_HEADER, directives);
}

/**
 * Merge the execution params of several profiles into one. thinkLevel takes the
 * strongest signal, reasoningLevel turns on if any asks for it, temperature is
 * averaged across those that set one. Used to derive run-level overrides from all
 * personas active on an agent.
 */
export function mergeExecParams(profiles: LimbicPsychProfile[]): AgentExecParams {
  const merged: AgentExecParams = {};
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
