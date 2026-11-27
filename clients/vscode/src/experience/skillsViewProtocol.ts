import type { ReviewEdits, RunStatus, Schedule, StepOutcome } from "@seanhogg/builderforce-memory-engine";
import type { LiveRunState } from "./skillRunnerPorts";

/**
 * What the Skills view's host and its page say to each other. Pure types: the host
 * (`skillsController.ts`) builds {@link SkillsState} projections of the store (never the
 * full skill JSON), the page (`skillsClient*.ts`) renders them, and the page answers with
 * {@link SkillsInbound}. No secret value ever travels host to page; a typed secret goes
 * page to host once, in `run.start`.
 */

export interface SkillParamView {
  name: string;
  label: string;
  secret: boolean;
  default: string | null;
  /** A secret already in the keychain (so the form need not ask again). */
  kept: boolean;
}

export interface SkillCardView {
  id: string;
  name: string;
  program: string;
  stepCount: number;
  params: SkillParamView[];
  routine: { schedule: Schedule; values: Record<string, string>; enabled: boolean } | null;
}

export interface RunRowView {
  id: string;
  skillName: string;
  trigger: string;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  error: string | null;
  steps: Array<{ idx: number; stepId: string; outcome: StepOutcome; detail: string | null }>;
}

/** One recorded step as the review shows it. */
export interface ReviewStepView {
  id: string;
  kind: "click" | "setValue" | "keys";
  /** The element's name, or the keys pressed; the page words it ("Click Send"). */
  target: string;
  /** A typed value that becomes a parameter unless pinned. */
  isValue: boolean;
  secret: boolean;
  /** The suggested parameter name. */
  paramName: string;
  /** Whether the step pauses for approval by default (an irreversible click). */
  requiresApproval: boolean;
}

export interface ReviewView {
  episodeId: string;
  name: string;
  program: string;
  steps: ReviewStepView[];
}

export interface SkillsState {
  /** The helper can run here. False renders "Not available on this system". */
  supported: boolean;
  /** `builderforce.agents.enabled` with consent given. */
  enabled: boolean;
  signedIn: boolean;
  phoneApprovals: boolean;
  skills: SkillCardView[];
  /** Newest first, at most 100. */
  runs: RunRowView[];
  live: LiveRunState | null;
  /** Steps captured so far while recording, else null. */
  recording: { count: number; program: string } | null;
  review: ReviewView | null;
  /** The last operation's failure, shown inline; cleared by the next success. */
  error: string | null;
}

/** Host to page. */
export type SkillsOutbound =
  | { type: "state"; state: SkillsState; labels: Record<string, string> }
  | { type: "recording.count"; count: number }
  | { type: "program.picked"; program: string };

export interface RoutineInput {
  schedule: Schedule;
  values: Record<string, string>;
  enabled: boolean;
}

/** Page to host. */
export type SkillsInbound =
  | { type: "ready" }
  | { type: "enable" }
  | { type: "phone.set"; on: boolean }
  | { type: "program.pick" }
  | { type: "record.start"; program: string }
  | { type: "record.stop" }
  | { type: "review.compile"; episodeId: string; edits: ReviewEdits }
  | { type: "review.discard"; episodeId: string }
  | { type: "run.start"; skillId: string; values: Record<string, string>; remember: string[] }
  | { type: "run.stop" }
  | { type: "approval.answer"; approved: boolean }
  | { type: "skill.schedule"; skillId: string; routine: RoutineInput | null }
  | { type: "skill.delete"; skillId: string };

export const MAX_HISTORY = 100;
