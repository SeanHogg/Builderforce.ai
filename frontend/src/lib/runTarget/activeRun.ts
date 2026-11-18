/**
 * The runs this TAB holds, by project — what the browser executor of the `runtime.*`
 * agent tools answers from. A browser run lives only in the tab that started it, so the
 * preview surface publishes its session here when it starts one and withdraws it when
 * it lets go; a tool call in this tab for that project reaches it, any other is routed
 * to the server (which answers for a container, or says the run is not reachable).
 */
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import type { RunSession } from './runTarget';
import type { TargetDecline } from './runTargetRegistry';

export interface ActiveRun {
  projectId: string;
  session: RunSession;
  /** Why other targets did not run it — what `preview_status` reports. */
  declined: TargetDecline[];
  /** The blueprint it was started from (its verify commands). */
  blueprint: AppBlueprint | null;
}

const runs = new Map<string, ActiveRun>();

export function publishActiveRun(run: ActiveRun): void {
  runs.set(run.projectId, run);
}

/** Withdraw `session` for its project — only if it is still the one published. */
export function withdrawActiveRun(projectId: string, session: RunSession): void {
  if (runs.get(projectId)?.session === session) runs.delete(projectId);
}

export function activeRunFor(projectId: string): ActiveRun | undefined {
  return runs.get(projectId);
}
