/**
 * routeRun — the run's PIPELINE route, decided ONCE (moved here from brain-embedded's `pipelineRoute.ts` so every
 * surface routes the same way): `full` (plan → code → verify) or `quick` (one coding pass: the run starts in `code` on the
 * quick model and its finish does not enter the verify stage). The score is `@builderforce/pipeline-route`'s over the
 * person's own request; the action type is the shared lexical classifier's.
 *
 * Only a request that carries `routing` is routed. A sub-agent (`child`) never is: it is a slice its owner already
 * planned, and starts in `code`.
 */
import { pipelineFeaturesOf, scorePipeline, type PipelineScore, type PipelineRoutingMode } from "@builderforce/pipeline-route";
import type { PhaseModels, RunPhase, RunPolicyOptions } from "@builderforce/run-policy";
import { classifyRunAction } from "@builderforce/workload";

/** What a surface hands to be routed. */
export interface RouteInput {
  /** The person's request text. */
  request: string;
  followUp?: boolean;
  /** Absent ⇒ not routed. */
  routing?: { mode: PipelineRoutingMode; threshold?: number; quickModel?: string };
  phaseModels?: PhaseModels;
  modelStrict?: boolean;
  /** A sub-agent is never routed and starts in `code`. */
  child?: boolean;
}

/** Common defaults. Hosts can supply stage models and a quick-model preference. */
export function defaultPipelineRouting(): NonNullable<RouteInput["routing"]> {
  return { mode: "always" };
}

/** Where the run starts, as the initial model policy takes it. */
export type RouteStart = Pick<RunPolicyOptions, "startPhase" | "phaseModels" | "pinnedModel">;

/** The route for this run, or null when it is not routed. */
export function decideRunPipeline(route: Pick<RouteInput, "request" | "followUp" | "routing" | "child">): PipelineScore | null {
  if (!route.routing || route.child) return null;
  const { actionType } = classifyRunAction(route.request);
  return scorePipeline(pipelineFeaturesOf(route.request, { actionType, followUp: route.followUp === true }), {
    mode: route.routing.mode,
    ...(route.routing.threshold !== undefined ? { threshold: route.routing.threshold } : {}),
  });
}

/**
 * Where the run starts and which model each phase asks for. A sub-agent starts in `code`; a quick run does too, coding on
 * the quick model. Every other run plans first. The quick model also wins over the run's SOFT model (a default, an Evermind
 * head, Auto's lock); a strict pin (the person's pick) is never overridden.
 */
export function pipelinePolicyOptions(route: Pick<RouteInput, "phaseModels" | "routing" | "child" | "modelStrict">, pipeline: PipelineScore | null): RouteStart {
  const quick = pipeline?.route === "quick";
  const startPhase: RunPhase = route.child || quick ? "code" : "plan";
  const phaseModels: PhaseModels = { ...route.phaseModels };
  const quickModel = route.routing?.quickModel?.trim();
  if (quick && quickModel) phaseModels.code = quickModel;
  return {
    startPhase,
    ...(Object.keys(phaseModels).length ? { phaseModels } : {}),
    ...(quick && quickModel && !route.modelStrict ? { pinnedModel: quickModel } : {}),
  };
}

/** A quick run ends on its coding pass: no verify stage. */
export function skipsVerifyStage(pipeline: PipelineScore | null): boolean {
  return pipeline?.route === "quick";
}

/** What routing decided: the score (or null), where the run starts, and whether it skips the verify stage. */
export interface RouteDecision {
  pipeline: PipelineScore | null;
  start: RouteStart;
  skipsVerify: boolean;
}

/** Route one run: the score (or null), where it starts, and whether it skips the verify stage. */
export function routeRun(route: RouteInput): RouteDecision {
  const pipeline = decideRunPipeline(route);
  return { pipeline, start: pipelinePolicyOptions(route, pipeline), skipsVerify: skipsVerifyStage(pipeline) };
}
