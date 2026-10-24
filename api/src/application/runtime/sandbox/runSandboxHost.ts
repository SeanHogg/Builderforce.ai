/**
 * The run's sandbox, as the run's CloudRunnerDO holds it — the one place a durable run
 * decides which sandbox it has, opens it, hands it to each tick and closes it.
 *
 * Two kinds, one {@link RunSandbox}:
 *   • `container` — the Cloudflare Container (`exec:<id>`), called over HTTP. Opened on
 *     the prep tick; any later call reopens it if the instance was recycled.
 *   • `actions` — the GitHub Actions runner the dispatch queued. It cannot be called, so
 *     it long-polls this DO ({@link handleRunnerPoll}) and the engine's requests wait in a
 *     {@link SandboxMailbox}. Ticks hold until the runner has said hello.
 *
 * A run with neither (no binding, no clonable repo, the container could not open) runs
 * without a shell — the git-API tools only — and its timeline says why.
 */
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import { recordCloudToolEvent } from '../cloudToolEvents';
import { createContainerSandbox, openRunSandbox, type RunSandbox, type SandboxTarget } from './runSandbox';
import { buildSandboxOpenSpec } from './sandboxOpenSpec';
import { createMailboxSandbox, SandboxMailbox, type SandboxMailPoll } from './sandboxMailbox';

export type RunSandboxKind = 'container' | 'actions';

/** What the host needs to know about the run. */
export interface SandboxRun {
  executionId: number;
  tenantId: number;
  projectId: number;
  taskId: number;
  cloudAgentRef?: string;
}

/** The slice of DO storage the host keeps its one flag in. */
export interface SandboxHostStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

/** Set once the Actions runner first polls — ticks hold until then. */
const RUNNER_SEEN_KEY = 'sandboxRunnerSeen';
/** How long an Actions run waits for GitHub to schedule its runner before failing. */
export const ACTIONS_RUNNER_WAIT_MS = 20 * 60_000;

export class RunSandboxHost {
  private mailbox = new SandboxMailbox();

  constructor(private readonly env: Env, private readonly db: Db, private readonly storage: SandboxHostStorage) {}

  private containerTarget(executionId: number): SandboxTarget | null {
    const ns = this.env.AGENT_CONTAINER;
    return ns ? ns.get(ns.idFromName(`exec:${executionId}`)) : null;
  }

  /**
   * The prep tick: which sandbox this run has. An Actions run always has its runner; any
   * other run gets the container when one is bound and the repository can be cloned,
   * opened now so the clone and the preview warm while the first turn is in flight.
   */
  async prepare(run: SandboxRun, executor: 'durable' | 'github_actions'): Promise<RunSandboxKind | undefined> {
    if (executor === 'github_actions') return 'actions';
    const target = this.containerTarget(run.executionId);
    if (!target) return undefined;
    const spec = await buildSandboxOpenSpec(this.env, this.db, run);
    if (!spec) return undefined;
    const opened = await openRunSandbox(target, spec);
    await recordCloudToolEvent(this.db, {
      tenantId: run.tenantId, cloudAgentRef: run.cloudAgentRef, executionId: run.executionId,
      toolName: 'runtime.sandbox', category: 'planning',
      detail: { kind: 'container', opened: opened.ok, ...(opened.error ? { reason: opened.error } : {}) },
      result: opened.ok
        ? 'Run sandbox ready: a shell and a clone of the ticket branch.'
        : `The run sandbox could not open (${opened.error}) — this run edits through the git API and has no shell.`,
    }).catch(() => undefined);
    return opened.ok ? 'container' : undefined;
  }

  /** The sandbox for one tick, or undefined for a run without one. */
  forTick(run: SandboxRun, kind: RunSandboxKind | undefined): RunSandbox | undefined {
    if (kind === 'actions') return createMailboxSandbox(this.mailbox);
    if (kind !== 'container') return undefined;
    const target = this.containerTarget(run.executionId);
    return target
      ? createContainerSandbox({ target, executionId: run.executionId, openSpec: () => buildSandboxOpenSpec(this.env, this.db, run) })
      : undefined;
  }

  /** An Actions run whose runner has not polled yet holds its tick. */
  async awaitingRunner(kind: RunSandboxKind | undefined): Promise<boolean> {
    return kind === 'actions' && !(await this.storage.get<boolean>(RUNNER_SEEN_KEY));
  }

  /** The Actions runner's poll for the engine's next request. */
  async handleRunnerPoll(): Promise<SandboxMailPoll> {
    await this.storage.put(RUNNER_SEEN_KEY, true);
    return this.mailbox.next();
  }

  /** The Actions runner's result for one request. */
  handleRunnerResult(id: string, result: unknown): boolean {
    return this.mailbox.resolve(id, result);
  }

  /**
   * The run is parked on a human question. An Actions runner is released (its job burns
   * the tenant's minutes while it waits); a container keeps its clone until it sleeps.
   */
  async park(kind: RunSandboxKind | undefined): Promise<void> {
    if (kind !== 'actions') return;
    this.mailbox.close();
    await this.storage.put(RUNNER_SEEN_KEY, false);
  }

  /** The parked run resumes: an Actions run gets a fresh mailbox for its new runner. */
  reopen(kind: RunSandboxKind | undefined): void {
    if (kind === 'actions') this.mailbox = new SandboxMailbox();
  }

  /** The run is over: release the sandbox. */
  async close(run: SandboxRun, kind: RunSandboxKind | undefined): Promise<void> {
    if (kind === 'actions') this.mailbox.close();
    else if (kind === 'container') await this.forTick(run, kind)?.close();
  }
}
