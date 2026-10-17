/**
 * Live run status for canvas-authored workflows.
 *
 * The history panel already polls GET /api/workflows/:id + /graph while
 * `isLiveWorkflowStatus`. The canvas board did not: a running flow still
 * showed compile-time skeletons. Graph node ids are orchestrator task
 * UUIDs, not board object ids, so matching is by id (when they coincide),
 * then title/label, then order — skipping synthetic trigger / :in / :out
 * extras the compiler splices in.
 *
 * No workflow websocket exists; this is a snapshot poll, same interval as
 * the history panel.
 */
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import { workflows, type WorkflowGraph } from '@/lib/builderforceApi';
import { reportBackgroundFailure } from '@/lib/reportError';
import { backoffDelay, isDocumentHidden } from '@/lib/polling/pollPolicy';
import { isLiveWorkflowStatus, LIVE_WORKFLOW_POLL_MS } from '../workflowRunUi';

export type LiveStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export type GraphNodeLike = { id: string; label: string; status: string };

export type FlowStepLike = { id: string; title: string; kind?: string };

export function normalizeLiveStepStatus(status: string | undefined | null): LiveStepStatus | null {
  if (!status) return null;
  const n = status.toLowerCase();
  if (n === 'completed' || n === 'complete' || n === 'delivered' || n === 'done') return 'completed';
  if (n.startsWith('fail') || n.startsWith('error')) return 'failed';
  if (n === 'running' || n.startsWith('progress') || n === 'in_progress') return 'running';
  if (n === 'pending' || n === 'queued' || n === 'idle') return 'pending';
  return null;
}

/** Same dots the legacy workflow card uses, so a live step and a card step agree. */
export function liveStepDotClass(
  status: string,
  // A CSS module's typing — an index signature, not the four named classes.
  styles: { readonly [key: string]: string | undefined },
): string {
  const n = status.toLowerCase();
  if (n.startsWith('fail') || n.startsWith('error')) return styles.failDot ?? '';
  if (n.startsWith('complete') || n.startsWith('done') || n === 'delivered') return styles.doneDot ?? '';
  if (n.startsWith('run') || n.startsWith('progress')) return styles.liveDot ?? '';
  return styles.idleDot ?? '';
}

function titlesMatch(stepTitle: string, graphLabel: string): boolean {
  const a = stepTitle.trim().toLowerCase();
  const b = graphLabel.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  // Graph labels are sliced to 80 chars on the API.
  if (b === a.slice(0, 80) || a === b.slice(0, 80)) return true;
  if (a.length >= 8 && (b.startsWith(a) || a.startsWith(b))) return true;
  return false;
}

function labelMatchesStep(step: FlowStepLike, node: GraphNodeLike): boolean {
  if (titlesMatch(step.title, node.label)) return true;
  if (step.kind === 'trigger' && /^trigger \(/i.test(node.label)) return true;
  return false;
}

function isCompilerId(id: string): boolean {
  return id === 'trigger' || id.endsWith(':in') || id.endsWith(':out');
}

function isDroppableExtra(node: GraphNodeLike): boolean {
  const label = node.label.trim();
  return /^Trigger \(/i.test(label) || /^Transform:/i.test(label) || label === 'Set variables';
}

/**
 * Drop compiler-spliced extras (synthetic trigger, data-in/out) when the graph
 * has more nodes than authored steps, so order-matching does not shift by one.
 */
export function authoredGraphNodes(graphNodes: readonly GraphNodeLike[], stepCount: number): GraphNodeLike[] {
  const nodes = graphNodes.filter((node) => !isCompilerId(node.id));
  if (nodes.length <= stepCount) return nodes;
  let extras = nodes.length - stepCount;
  const kept: GraphNodeLike[] = [];
  for (const node of nodes) {
    if (extras > 0 && isDroppableExtra(node)) {
      extras -= 1;
      continue;
    }
    kept.push(node);
  }
  return kept;
}

export function mapGraphNodesToFlowSteps(
  steps: readonly FlowStepLike[],
  graphNodes: readonly GraphNodeLike[],
): Map<string, LiveStepStatus> {
  const mapped = new Map<string, LiveStepStatus>();
  if (steps.length === 0 || graphNodes.length === 0) return mapped;

  const remaining = authoredGraphNodes(graphNodes, steps.length);
  const unused = remaining.map((_, i) => i);

  const take = (step: FlowStepLike, node: GraphNodeLike, index: number) => {
    const status = normalizeLiveStepStatus(node.status);
    if (status) mapped.set(step.id, status);
    unused.splice(unused.indexOf(index), 1);
  };

  for (const step of steps) {
    const byId = unused.findIndex((i) => remaining[i]!.id === step.id);
    if (byId >= 0) {
      take(step, remaining[unused[byId]!]!, unused[byId]!);
    }
  }

  for (const step of steps) {
    if (mapped.has(step.id)) continue;
    const byLabel = unused.findIndex((i) => labelMatchesStep(step, remaining[i]!));
    if (byLabel >= 0) {
      take(step, remaining[unused[byLabel]!]!, unused[byLabel]!);
    }
  }

  const unmatched = steps.filter((step) => !mapped.has(step.id));
  const zip = Math.min(unmatched.length, unused.length);
  for (let i = 0; i < zip; i += 1) {
    take(unmatched[i]!, remaining[unused[0]!]!, unused[0]!);
  }

  return mapped;
}

function stepIsBlocked(data: CanvasObject['data']): boolean {
  return typeof data.flowStepIssue === 'string' && data.flowStepIssue.length > 0;
}

export function applyLiveGraphToNodes(
  nodes: CanvasObject[],
  args: {
    targetId: string;
    memberIds: ReadonlySet<string> | null;
    graphNodes: readonly GraphNodeLike[];
  },
): CanvasObject[] {
  const flowSteps: FlowStepLike[] = [];
  for (const node of nodes) {
    if (node.data.kind !== 'flowStep') continue;
    if (args.memberIds && !args.memberIds.has(node.id)) continue;
    flowSteps.push({
      id: node.id,
      title: String(node.data.title ?? ''),
      kind: typeof node.data.stepKind === 'string' ? node.data.stepKind : undefined,
    });
  }
  const flowMapped = mapGraphNodesToFlowSteps(flowSteps, args.graphNodes);

  return nodes.map((node) => {
    const live = flowMapped.get(node.id);
    if (live) {
      return {
        ...node,
        data: {
          ...node.data,
          workflowRunStatus: live,
          ...(stepIsBlocked(node.data) ? {} : { status: live }),
        },
      };
    }
    if (node.id !== args.targetId || !Array.isArray(node.data.steps)) return node;
    const authored = node.data.steps as unknown[];
    const asSteps: FlowStepLike[] = authored.map((step, index) => {
      const rec = step && typeof step === 'object' ? (step as Record<string, unknown>) : {};
      return {
        id: String(rec.id ?? `${node.id}:step:${index}`),
        title: String(rec.title ?? rec.name ?? ''),
        kind: typeof rec.kind === 'string' ? rec.kind : undefined,
      };
    });
    const stepMapped = mapGraphNodesToFlowSteps(asSteps, args.graphNodes);
    if (stepMapped.size === 0) return node;
    const nextSteps = authored.map((step, index) => {
      const rec: Record<string, unknown> = step && typeof step === 'object' ? { ...(step as Record<string, unknown>) } : { title: String(step) };
      const id = String(rec.id ?? `${node.id}:step:${index}`);
      const status = stepMapped.get(id);
      return status ? { ...rec, status } : rec;
    });
    return { ...node, data: { ...node.data, steps: nextSteps } };
  });
}

export type LiveWorkflowSnapshot = {
  status: string;
  completedAt?: string | null;
  graph: WorkflowGraph | null;
};

/**
 * Poll GET /api/workflows/:id + /graph until the run leaves pending/running.
 * Returns a stop function. First tick is immediate; later ticks use
 * LIVE_WORKFLOW_POLL_MS. Pending-approval callers must not start this.
 *
 * The snapshot carries the run's own status + completedAt, so a caller reads the
 * terminal state from `onTick` — there is no second poll of the definition's run
 * list. It is imperative (started from a click, one per run), so it applies the
 * `usePolledResource` rules itself: no tick while the tab is hidden (one runs on
 * return), a failed tick doubles the wait up to eight intervals, ticks never
 * overlap, and `maxTicks` bounds it.
 */
export function startCanvasWorkflowLivePoll(opts: {
  runId: string;
  onTick: (snapshot: LiveWorkflowSnapshot) => void;
  intervalMs?: number;
  maxTicks?: number;
}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticks = 0;
  const interval = opts.intervalMs ?? LIVE_WORKFLOW_POLL_MS;
  const maxTicks = opts.maxTicks ?? 30;
  let delay = interval;
  let waitingForVisible = false;

  const hidden = isDocumentHidden;
  const onVisibility = () => {
    if (!waitingForVisible || hidden()) return;
    waitingForVisible = false;
    document.removeEventListener('visibilitychange', onVisibility);
    tick();
  };
  const scheduleNext = () => {
    if (stopped) return;
    ticks += 1;
    if (ticks >= maxTicks) return;
    timer = setTimeout(tick, delay);
  };

  function tick() {
    if (stopped) return;
    if (hidden()) {
      if (!waitingForVisible) {
        waitingForVisible = true;
        document.addEventListener('visibilitychange', onVisibility);
      }
      return;
    }
    void Promise.all([
      workflows.get(opts.runId),
      workflows.getGraph(opts.runId).catch((error: unknown) => {
        void reportBackgroundFailure({
          message: error instanceof Error ? error.message : String(error),
          level: 'warning',
          context: { operation: 'canvasWorkflow.liveGraph', runId: opts.runId },
        });
        return null;
      }),
    ]).then(([snapshot, graph]) => {
      if (stopped) return;
      delay = interval;
      opts.onTick({ status: snapshot.status, completedAt: snapshot.completedAt, graph });
      if (!isLiveWorkflowStatus(snapshot.status)) return;
      scheduleNext();
    }).catch((error: unknown) => {
      void reportBackgroundFailure({
        message: error instanceof Error ? error.message : String(error),
        level: 'warning',
        context: { operation: 'canvasWorkflow.livePoll', runId: opts.runId },
      });
      delay = backoffDelay(delay, interval);
      scheduleNext();
    });
  }

  tick();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    if (waitingForVisible && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}
