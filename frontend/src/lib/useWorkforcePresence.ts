import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { usePolledResource } from '@/hooks/usePolledResource';
import { membersApi, type TenantMember } from '@/lib/auth/members';
import {
  vscodeConnections, isVscodeConnectionOnline,
  type AgentHost, type VscodeConnection,
} from '@/lib/builderforceApi';
import { readAgentHosts } from '@/lib/dashboardReads';
import { createLiveRunsReader, EMPTY_LIVE_RUNS, type LiveRunsSnapshot } from '@/lib/liveRunsApi';

/** The sparkline window — runs started per day, counted by the server. */
const ACTIVITY_DAYS = 14;

/**
 * Live "who's online / what's working" presence across the whole workforce —
 * humans AND agents — in ONE hook so every surface (dashboard tile, presence
 * strip, anywhere else) reads the same roster and can't drift. Combines three
 * fresh liveness signals: online VS Code editors + members with an active
 * session (people), online agent hosts (agents idle), and in-flight executions
 * (agents working). Polls on an interval so the roster stays current.
 *
 * The runs side is ONE version-gated read of the live-runs projection
 * (`lib/liveRunsApi`) carrying the in-flight runs AND the 14-day per-day counts —
 * it used to be the active list plus the tenant's 200 newest full execution rows,
 * bucketed here. While no run changes state a tick ships no run payload at all.
 */

export interface PresencePerson {
  userId: string | null;
  name: string;
  /** Short "why they're online" caption (e.g. "In IDE" / "Active session"). */
  detail: string;
  inIde: boolean;
}

export interface PresenceAgent {
  key: string;
  name: string;
  working: boolean;
  taskTitle?: string;
  elapsedMs?: number | null;
  kind?: 'cloud' | 'on-prem';
}

export interface WorkforcePresence {
  people: PresencePerson[];
  agents: PresenceAgent[];
  /** Distinct agents with at least one in-flight run. */
  workingCount: number;
  /** Everyone present right now — online people + present agents. */
  onlineCount: number;
  /** 14-day runs-per-day trend (honest activity sparkline). */
  activitySeries: number[];
  loading: boolean;
}

const POLL_MS = 30_000;

export interface WorkforcePresenceOptions {
  /**
   * Keep the roster live (re-read every 30 s). `false` reads it ONCE (and again
   * when the tab returns to view) — what a page wants when only a headline count
   * is on screen and the live roster (the presence strip) is not. Default true.
   */
  live?: boolean;
}

export function useWorkforcePresence({ live = true }: WorkforcePresenceOptions = {}): WorkforcePresence {
  const { isAuthenticated, hasTenant, tenant, tenantToken } = useAuth();

  const [vscodeConns, setVscodeConns] = useState<VscodeConnection[]>([]);
  const [hosts, setHosts] = useState<AgentHost[]>([]);
  const [runs, setRuns] = useState<LiveRunsSnapshot>(EMPTY_LIVE_RUNS);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [loading, setLoading] = useState(true);

  // One version-gated reader. A tenant switch needs no fresh one: version tokens are
  // per tenant, so the held token never matches the new tenant's and the body ships.
  const reader = useMemo(() => createLiveRunsReader({ activityDays: ACTIVITY_DAYS }), []);

  const load = useCallback(async () => {
    if (!isAuthenticated || !hasTenant) return;
    const [conns, hostList, liveRuns] = await Promise.allSettled([
      vscodeConnections.list(),
      readAgentHosts(),
      reader.read(),
    ]);
    // Each feed settles on its own: a failed one keeps its last value.
    if (conns.status === 'fulfilled') setVscodeConns(Array.isArray(conns.value) ? conns.value : []);
    if (hostList.status === 'fulfilled') setHosts(Array.isArray(hostList.value) ? hostList.value : []);
    if (liveRuns.status === 'fulfilled') setRuns(liveRuns.value);
    // Members resolve human names/avatars and add web-session presence; they need
    // the tenant token and change slowly, so a failure just degrades gracefully.
    if (tenant && tenantToken) {
      membersApi.list(String(tenant.id))
        .then((m) => setMembers(Array.isArray(m) ? m : []))
        .catch(() => { /* keep last */ });
    }
  }, [isAuthenticated, hasTenant, tenant, tenantToken, reader]);

  // The shared poller, not a bare setInterval: it skips ticks while the tab is
  // hidden (four requests every 30s from every background tab otherwise), backs
  // off on errors, and restarts on a tenant change.
  const enabled = isAuthenticated && hasTenant;
  useEffect(() => {
    if (!enabled) setLoading(false);
  }, [enabled]);
  const loadOnce = useCallback(async () => {
    try {
      await load();
    } finally {
      setLoading(false);
    }
  }, [load]);
  // Not live ⇒ the immediate read only (`maxTicks: 0`); flipping to live restarts
  // the poll with a fresh read.
  usePolledResource(loadOnce, { intervalMs: POLL_MS, enabled, maxTicks: live ? undefined : 0, restartKey: tenant?.id ?? null });

  return useMemo(() => {
    const membersById = new Map(members.map((m) => [m.id, m]));
    const nameFor = (userId: string | null, fallback: string) => {
      if (userId) {
        const m = membersById.get(userId);
        if (m) return m.displayName || m.username || m.email || fallback;
      }
      return fallback;
    };

    // People — online editors first, then members with a live web session that
    // aren't already surfaced via the IDE (deduped by userId).
    const people: PresencePerson[] = [];
    const seenUsers = new Set<string>();
    for (const c of vscodeConns) {
      if (!isVscodeConnectionOnline(c)) continue;
      const key = c.userId ?? `machine:${c.machineName}`;
      if (seenUsers.has(key)) continue;
      seenUsers.add(key);
      people.push({ userId: c.userId, name: nameFor(c.userId, c.machineName), detail: c.machineName, inIde: true });
    }
    for (const m of members) {
      if (m.activeSessions > 0 && !seenUsers.has(m.id)) {
        seenUsers.add(m.id);
        people.push({ userId: m.id, name: m.displayName || m.username || m.email, detail: m.email, inIde: false });
      }
    }

    // Agents — union of online hosts (idle) and in-flight runs (working). A host
    // that's also running is marked working, with its current task + elapsed.
    const agentByKey = new Map<string, PresenceAgent>();
    const hostById = new Map(hosts.map((h) => [h.id, h]));
    for (const h of hosts) {
      if (h.online) agentByKey.set(`host:${h.id}`, { key: `host:${h.id}`, name: h.name, working: false });
    }
    for (const run of runs.active) {
      const key = run.agentHostId != null ? `host:${run.agentHostId}` : run.cloudAgentRef ? `cloud:${run.cloudAgentRef}` : `run:${run.id}`;
      const name = run.agentHostId != null
        ? (hostById.get(run.agentHostId)?.name ?? `Agent #${run.agentHostId}`)
        : (run.cloudAgentRef ?? `Agent`);
      agentByKey.set(key, { key, name, working: true, taskTitle: run.taskTitle, elapsedMs: run.elapsedMs, kind: run.kind });
    }
    const agents = [...agentByKey.values()].sort((a, b) => Number(b.working) - Number(a.working));
    const workingCount = agents.filter((a) => a.working).length;

    const activitySeries = runs.activity.length ? runs.activity : new Array<number>(ACTIVITY_DAYS).fill(0);

    return {
      people,
      agents,
      workingCount,
      onlineCount: people.length + agents.length,
      activitySeries,
      loading,
    };
  }, [members, vscodeConns, hosts, runs, loading]);
}
