'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { listTenantMembers, type TenantMember } from '@/lib/auth';
import {
  agentHosts, vscodeConnections, runtimeApi, isVscodeConnectionOnline,
  type AgentHost, type VscodeConnection, type ActiveRun, type Execution,
} from '@/lib/builderforceApi';
import { dailyCounts } from '@/components/dashboard/seriesFromTimestamps';

/**
 * Live "who's online / what's working" presence across the whole workforce —
 * humans AND agents — in ONE hook so every surface (dashboard tile, presence
 * strip, anywhere else) reads the same roster and can't drift. Combines three
 * fresh liveness signals: online VS Code editors + members with an active
 * session (people), online agent hosts (agents idle), and in-flight executions
 * (agents working). Polls on an interval so the roster stays current.
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

export function useWorkforcePresence(): WorkforcePresence {
  const { isAuthenticated, hasTenant, tenant, tenantToken } = useAuth();

  const [vscodeConns, setVscodeConns] = useState<VscodeConnection[]>([]);
  const [hosts, setHosts] = useState<AgentHost[]>([]);
  const [active, setActive] = useState<ActiveRun[]>([]);
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [recent, setRecent] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isAuthenticated || !hasTenant) return;
    const [conns, hostList, activeRes, recentList] = await Promise.all([
      vscodeConnections.list().catch(() => [] as VscodeConnection[]),
      agentHosts.list().catch(() => [] as AgentHost[]),
      runtimeApi.listActive().catch(() => ({ active: [] as ActiveRun[], runningCloudRefs: [] as string[] })),
      runtimeApi.listRecent(200).catch(() => [] as Execution[]),
    ]);
    setVscodeConns(Array.isArray(conns) ? conns : []);
    setHosts(Array.isArray(hostList) ? hostList : []);
    setActive(Array.isArray(activeRes.active) ? activeRes.active : []);
    setRecent(Array.isArray(recentList) ? recentList : []);
    // Members resolve human names/avatars and add web-session presence; they need
    // the tenant token and change slowly, so a failure just degrades gracefully.
    if (tenant && tenantToken) {
      listTenantMembers(tenantToken, String(tenant.id))
        .then((m) => setMembers(Array.isArray(m) ? m : []))
        .catch(() => { /* keep last */ });
    }
  }, [isAuthenticated, hasTenant, tenant, tenantToken]);

  useEffect(() => {
    if (!isAuthenticated || !hasTenant) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    void load().finally(() => { if (alive) setLoading(false); });
    const id = setInterval(() => { void load(); }, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [isAuthenticated, hasTenant, load]);

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
    for (const run of active) {
      const key = run.agentHostId != null ? `host:${run.agentHostId}` : run.cloudAgentRef ? `cloud:${run.cloudAgentRef}` : `run:${run.id}`;
      const name = run.agentHostId != null
        ? (hostById.get(run.agentHostId)?.name ?? `Agent #${run.agentHostId}`)
        : (run.cloudAgentRef ?? `Agent`);
      agentByKey.set(key, { key, name, working: true, taskTitle: run.taskTitle, elapsedMs: run.elapsedMs, kind: run.kind });
    }
    const agents = [...agentByKey.values()].sort((a, b) => Number(b.working) - Number(a.working));
    const workingCount = agents.filter((a) => a.working).length;

    const activitySeries = dailyCounts(recent.map((e) => e.createdAt), 14);

    return {
      people,
      agents,
      workingCount,
      onlineCount: people.length + agents.length,
      activitySeries,
      loading,
    };
  }, [members, vscodeConns, hosts, active, recent, loading]);
}
