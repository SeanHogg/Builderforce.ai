/**
 * RuntimeService ports — the typed seams {@link RuntimeService} calls out through.
 *
 * The service used to take sixteen POSITIONAL constructor arguments (four
 * repositories + twelve optional callbacks), so every test had to count
 * `undefined`s to reach the one hook it cared about, and appending a hook was the
 * only safe way to add one. It now takes ONE {@link RuntimeServiceOptions} object:
 * the repositories are required, every port is optional and named.
 *
 * Every port is best-effort by contract unless its doc says otherwise — the
 * service isolates, retries and audits a failing effect (`runEffect`) rather than
 * letting it block a status transition.
 */
import type { PolicyGate } from '@builderforce/agent-tools';
import type { IExecutionRepository } from '../../domain/execution/IExecutionRepository';
import type { ITaskRepository } from '../../domain/task/ITaskRepository';
import type { IAgentRepository } from '../../domain/agent/IAgentRepository';
import type { IAuditRepository } from '../../domain/audit/IAuditRepository';
import type { Execution } from '../../domain/execution/Execution';
import type { RunMilestonePhase } from '../brain/ChatTicketService';

/** A ticket lane move (or terminal stamp) driven by an execution. */
export interface TaskStatusSyncInfo {
  tenantId: number; taskId: number; projectId: number;
  fromStatus: string; toStatus: string; terminal: boolean;
  /** WHICH agent moved the lane — the execution's cloud agent ref / host id. */
  actorAgentRef: string | null; actorAgentHostId: number | null;
}

/** An execution advanced its ticket into a new non-terminal lane. */
export interface LaneEntryInfo {
  tenantId: number; taskId: number; projectId: number; status: string;
  /** The lane the just-completed run was dispatched FOR (stamped in its payload
   *  by the auto-run trigger). Lets the trigger skip a same-lane re-entry loop
   *  WITHOUT blocking a genuine handoff to a different lane staffed by the same
   *  agent. Absent for manual / human-drag runs. */
  originLaneKey?: string;
}

export interface NextStatusQuery {
  projectId: number; fromStatus: string;
}

export interface RunningStatusQuery {
  projectId: number; fromStatus: string; dispatchedLaneKey: string | null;
}

export interface RunMilestoneInfo {
  tenantId: number; taskId: number; projectId: number; taskType: string;
  agentRef: string | null; executionId: number;
  phase: RunMilestonePhase;
  toStatus?: string | null; resultText?: string | null; errorMessage?: string | null;
  /** The `ask_human` question (paused phase) so the chat shows WHAT the agent needs. */
  questionText?: string | null;
  /** Uniquifies repeatable phases (paused/resumed once per question cycle) in the
   *  idempotency key — the approval id at the ask_human/answer sites. */
  eventNonce?: string | null;
}

export interface RunFinalizedInfo {
  tenantId: number; taskId: number; projectId: number; executionId: number;
  status: 'completed' | 'failed'; actAsRole: string | null; laneServed: string | null;
}

export interface ManagedRunStatusInfo {
  tenantId: number; taskId: number; projectId: number; executionId: number;
  status: 'running' | 'completed' | 'failed'; fromStatus: string;
  actAsRole: string | null; laneServed: string | null;
}

export interface ManagedRunStatusResult {
  managed: boolean; toStatus: string;
}

export interface PolicyGateScope {
  tenantId: number; projectId: number | null; agentRef: string | null;
}

/** The persistence the service cannot run without. */
export interface RuntimeRepositories {
  executions: IExecutionRepository;
  tasks: ITaskRepository;
  agents: IAgentRepository;
  audit: IAuditRepository;
}

/** Every optional side-effect / resolver seam. Absent ⇒ the legacy default. */
export interface RuntimePorts {
  /**
   * Invoked whenever an execution terminally fails (in-loop FAILED transition or
   * orphan-reap). Wired to write a `run.failed` tool-audit event so the failure
   * surfaces on the Observability Logs + Timeline, which are derived only from
   * tool-audit telemetry.
   */
  onTerminalFailure?: (e: Execution) => Promise<void>;
  /**
   * Invoked whenever an execution syncs its task's status (an agent moving a
   * ticket through lanes) or reaches a terminal state. Wired to the ticket-metrics
   * layer (`syncExecutionTaskLifecycle`) so agent lane moves record transitions
   * exactly like a human PATCH and a terminal run stamps the work-stopped signal.
   *
   * Carries the RUNNING agent's identity so the transition log names WHICH agent
   * hopped the lane — not passing it is why every agent move read as an anonymous
   * 'system' write.
   */
  onTaskStatusSync?: (info: TaskStatusSyncInfo) => Promise<void>;
  /**
   * Cloud-orphan self-heal. Invoked for a stale CLOUD run BEFORE it is failed, so
   * a crashed/evicted run is re-queued once on the durable executor instead of
   * being permanently failed by whichever reader noticed it first. Returns
   * `'requeued'` when it recovered the run (left running) or `'failed'` to let the
   * normal orphan-fail proceed. Idempotent + once-only by contract.
   */
  onCloudOrphan?: (e: Execution) => Promise<'requeued' | 'failed'>;
  /**
   * Autonomous-trigger sink invoked when an execution ADVANCES its ticket into a
   * new non-terminal lane. Wired to the SAME lane auto-run trigger a human
   * board-drag uses (`maybeAutoRunOnLaneEntry`), so the next lane's configured
   * cloud agent kicks off after an agent finishes. The trigger itself is
   * idempotent (dedupes on a live execution) and no-ops on a Done lane.
   */
  onLaneEntry?: (info: LaneEntryInfo) => Promise<void>;
  /**
   * The board's NEXT swimlane by configured order — used to advance a ticket on
   * COMPLETED to whatever lane the board defines after the current one, instead of
   * a hardcoded `in_review`. Returns null for a non-board task or an unresolvable
   * lane, so the default (in_review) still applies.
   */
  resolveNextStatus?: (info: NextStatusQuery) => Promise<string | null>;
  /**
   * Run-milestone sink invoked when an execution STARTS, COMPLETES or FAILS (and
   * from the direct-write lifecycle sites) — so a cloud-agent run narrates its
   * progress into every Brain chat the ticket is linked to. Per-execution+phase
   * idempotent; called AFTER the lane sync + chaining side-effects and must never
   * block them.
   */
  onRunMilestone?: (info: RunMilestoneInfo) => Promise<void>;
  /**
   * Attribution sink invoked when a run reaches a TERMINAL status — so the
   * Coordinated Role Participation manifest can record that "role X participated"
   * (linked to the execution it ran as). Called after all lane/metrics
   * side-effects and must never block them.
   */
  onRunFinalized?: (info: RunFinalizedInfo) => Promise<void>;
  /**
   * Managed-board coordination seam. When it returns managed=true, the Coordinator
   * owns every task-status transition for this execution and the legacy lane
   * writer is bypassed.
   */
  onManagedRunStatus?: (info: ManagedRunStatusInfo) => Promise<ManagedRunStatusResult>;
  /**
   * Governance-gate resolver. `submit` is the ONE funnel every execution passes
   * through, so stamping the tenant's effective {@link PolicyGate}s onto the
   * payload there is what makes an authored policy pack reach the engine's
   * `evaluatePolicyGate` seam on every real run. NOT best-effort: a wired resolver
   * that fails blocks the dispatch (fail-closed).
   */
  resolvePolicyGates?: (scope: PolicyGateScope) => Promise<PolicyGate[]>;
  /** Canonical agent-registration lookup; null ⇒ not found. */
  resolveAgentRegistration?: (id: string, tenantId: number) => Promise<{ active: boolean } | null>;
  /** Authoritative workspace kill switch; production always wires it. */
  isAgentExecutionEnabled?: (tenantId: number) => Promise<boolean>;
  /**
   * The lane a ticket belongs in when a run STARTS. Prefers the lane the run was
   * DISPATCHED FOR over the `in_progress` constant, so a board whose lanes are
   * `intake → spec → build → qa → ship` does not have its ticket written to a
   * status matching no column. Returns null for "leave the ticket where it is";
   * absent ⇒ the legacy constant.
   */
  resolveRunningStatus?: (info: RunningStatusQuery) => Promise<string | null>;
}

/** The ONE constructor argument of {@link RuntimeService}. */
export type RuntimeServiceOptions = RuntimeRepositories & RuntimePorts;
