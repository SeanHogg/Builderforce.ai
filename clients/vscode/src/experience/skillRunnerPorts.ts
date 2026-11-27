import type { Run, RunStatus, Skill, StepOutcome } from "@seanhogg/builderforce-memory-engine";
import type { PhoneApprovalRelay } from "./phoneApprovalRelay";
import type { SkillSecrets } from "./skillSecrets";
import type { TeachHelperPort } from "./teachHelper";

/** The store operations a run needs (a slice of `SkillOps`). Each write reports its failure by rejecting. */
export interface RunStore {
  getSkill(id: string): Promise<Skill | undefined>;
  startRun(skillId: string, trigger: string): Promise<Run>;
  stepRun(input: { runId: string; idx: number; stepId: string; outcome: StepOutcome; detail?: string | null }): Promise<void>;
  finishRun(runId: string, status: RunStatus, error?: string | null): Promise<void>;
  listRuns(limit: number): Promise<Run[]>;
}

export interface RunnerClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The user-facing strings the runner writes, localized by the host (the runner has no `vscode`). */
export interface RunnerMessages {
  orphaned: string;
  unsupported: string;
  busy: string;
  unknownSkill(id: string): string;
  approvalDescription(skillName: string, step: number, action: string): string;
  lastRun(skillName: string, status: RunStatus, whenIso: string, trigger: string): string;
}

export interface SkillRunnerPorts {
  helper: TeachHelperPort;
  store: RunStore;
  secrets: SkillSecrets;
  relay: PhoneApprovalRelay;
  clock: RunnerClock;
  messages: RunnerMessages;
  /** Writes the `synapse.skill.<id>.last-run` fact through the extension's memory remember path. */
  remember(fact: { key: string; content: string; tags: string[] }): Promise<void>;
  report(error: unknown, operation: string): void;
}

/** What the view shows of the run in flight. */
export interface LiveRunState {
  runId: string;
  skillId: string;
  skillName: string;
  trigger: string;
  totalSteps: number;
  /** 1-based number of the step being driven, or null before the first. */
  currentStep: number | null;
  /** The gate waiting on a person (here or on the phone). */
  approval: { idx: number; description: string } | null;
}

export interface StartRequest {
  skillId: string;
  trigger: "manual" | "routine";
  /** Values the person gave in the run form; they win over everything else. */
  values?: Record<string, string>;
  /** Secret parameter names to keep in the OS keychain for next time. */
  remember?: string[];
}

export type StartResult = { ok: true; runId: string; done: Promise<void> } | { ok: false; error: string };

/** The longest a gate waits for an answer before it counts as "no". */
export const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;
