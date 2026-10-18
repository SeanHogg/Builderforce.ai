/**
 * The ONE live-runs read — `GET /api/runtime/active` — and the version-gated
 * reader every panel that shows what the fleet is doing polls through: the
 * active-runs panel, the dashboard's workforce presence and the board's run chips.
 *
 * The server caches the read behind the tenant's execution-state version token and
 * returns that token as `version`. {@link createLiveRunsReader} sends it back as
 * `since`; while no run has changed state the answer is `{ version, unchanged }` —
 * no database read, no payload — and the reader hands back the snapshot it already
 * holds (the SAME object, so nothing re-renders). Its own module rather than a
 * section of `builderforceApi.ts`, which every feature used to grow.
 */

import { request } from './builderforceApi';

export interface ActiveRun {
  id: number;
  status: 'pending' | 'submitted' | 'running';
  taskId: number;
  taskTitle: string;
  projectId: number;
  projectName: string;
  agentHostId: number | null;
  cloudAgentRef: string | null;
  agentName: string | null;
  submittedBy: string;
  startedAt: string | null;
  createdAt: string;
  kind: 'cloud' | 'on-prem';
  /** Elapsed at the moment the server answered — add {@link LiveRunsSnapshot.receivedAt} drift for "now". */
  elapsedMs: number | null;
}

/** The newest run per (task, agent) — the board's agent-history chips. A type alias so it
 *  satisfies `Execution`'s open shape. */
export type TaskRun = {
  id: number;
  taskId: number;
  status: string;
  agentHostId: number | null;
  agentId: number | null;
  cloudAgentRef: string | null;
  createdAt: string;
};

export interface LiveRunsQuery {
  /** 1–30: include runs-started-per-day over the trailing window (oldest first). */
  activityDays?: number;
  /** Include the latest run per (task, agent) for this project, or `'all'` projects. */
  taskRuns?: number | 'all';
}

interface LiveRunsWire {
  version: string;
  unchanged?: true;
  active?: ActiveRun[];
  runningCloudRefs?: string[];
  activity?: number[];
  taskRuns?: TaskRun[];
}

export interface LiveRunsSnapshot {
  /** Every non-terminal run, newest first. */
  active: ActiveRun[];
  /** Cloud agent refs with at least one in-flight run (for the "running" pill). */
  runningCloudRefs: string[];
  /** Present when the query asked for `activityDays`. */
  activity: number[];
  /** Present when the query asked for `taskRuns`. */
  taskRuns: TaskRun[];
  /** Epoch ms this body arrived — `elapsedMs` was measured then. */
  receivedAt: number;
}

export const EMPTY_LIVE_RUNS: LiveRunsSnapshot = { active: [], runningCloudRefs: [], activity: [], taskRuns: [], receivedAt: 0 };

export const liveRunsApi = {
  /** One read of the live-runs projection. `since` = the `version` of the last answer. */
  read: (query: LiveRunsQuery & { since?: string } = {}): Promise<LiveRunsWire> => {
    const params = new URLSearchParams();
    if (query.since) params.set('since', query.since);
    if (query.activityDays) {
      params.set('activityDays', String(query.activityDays));
      // The viewer's calendar day, so "today" on the sparkline is their today.
      params.set('tzOffset', String(-new Date().getTimezoneOffset()));
    }
    if (query.taskRuns != null) params.set('taskRuns', String(query.taskRuns));
    const q = params.toString();
    return request<LiveRunsWire>(`/api/runtime/active${q ? `?${q}` : ''}`);
  },
};

export interface LiveRunsReader {
  /** The current snapshot — the held one (same object) while the server says nothing moved. */
  read: () => Promise<LiveRunsSnapshot>;
}

/** A version-gated reader for one query. Create one per query (per panel / per project). */
export function createLiveRunsReader(query: LiveRunsQuery = {}): LiveRunsReader {
  let version: string | undefined;
  let held: LiveRunsSnapshot | null = null;
  return {
    async read() {
      const wire = await liveRunsApi.read({ ...query, since: held ? version : undefined });
      if (wire.unchanged && held) return held;
      version = wire.version || undefined;
      held = {
        active: Array.isArray(wire.active) ? wire.active : [],
        runningCloudRefs: Array.isArray(wire.runningCloudRefs) ? wire.runningCloudRefs : [],
        activity: Array.isArray(wire.activity) ? wire.activity : [],
        taskRuns: Array.isArray(wire.taskRuns) ? wire.taskRuns : [],
        receivedAt: Date.now(),
      };
      return held;
    },
  };
}

/** A run's elapsed time NOW, from the snapshot it arrived in. */
export function elapsedNow(run: Pick<ActiveRun, 'elapsedMs'>, snapshot: Pick<LiveRunsSnapshot, 'receivedAt'>, now: number = Date.now()): number | null {
  return run.elapsedMs == null ? null : run.elapsedMs + Math.max(0, now - snapshot.receivedAt);
}
