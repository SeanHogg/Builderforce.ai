'use client';

import { Select } from '@/components/Select';

import Link from 'next/link';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  agentHosts,
  cloudAgents as cloudAgentsApi,
  workflows,
  type AgentHost,
  type ToolAuditEvent,
  type Workflow,
} from '@/lib/builderforceApi';
import { AgentHostGateway } from '@/lib/agentHostGateway';
import { loadAgentPool, type PoolAgent } from '@/lib/agentPool';
import { ExecutionTimelineChart } from './ExecutionTimelineChart';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export type ObservabilityView = 'logs' | 'timeline';

export interface ObservabilityContentProps {
  /** Optional initial view. Defaults to 'logs'. */
  initialView?: ObservabilityView;
  /** Optional className for the root wrapper. */
  className?: string;
  /** Optional inline style for the root wrapper. */
  style?: React.CSSProperties;
  /** When set (e.g. from agentHost panel), scope observability to this agentHost. */
  agentHostId?: number;
  /** Display name for the agentHost when agentHostId is set. */
  agentHostName?: string;
}

/** Both self-hosted hosts and cloud agents are agents — one unified directory. */
type AgentKind = 'host' | 'cloud';

interface UnifiedAgent {
  /** Stable selection key: `host:<id>` or `cloud:<ref>`. */
  key: string;
  kind: AgentKind;
  /** agent_hosts.id for kind 'host'. */
  hostId?: number;
  /** ide_agents.id (cloud ref) for kind 'cloud'. */
  cloudRef?: string;
  name: string;
  /** Live-connection status — hosts only. */
  online?: boolean;
}

interface LogLine {
  ts: string;
  level: string;
  msg: string;
  agentKey: string;
  agentName: string;
}

interface TimelineTrack {
  label: string;
  kind: 'tool' | 'workflow-task';
  startMs: number;
  endMs: number;
  status: string;
  detail?: string;
  agentKey: string;
  agentName: string;
}

function truncate(s: unknown, n: number): string {
  const str = typeof s === 'string' ? s : JSON.stringify(s ?? '') ?? '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

const AGENT_COLORS = [
  'var(--coral-bright, #f97316)',
  'var(--accent, #6366f1)',
  'var(--green, #22c55e)',
  'var(--blue, #3b82f6)',
  'var(--amber, #f59e0b)',
];

/** Stable per-agent color, indexed by position in the current selection. */
function colorForKey(selectedKeys: string[], key: string): string {
  const idx = selectedKeys.indexOf(key);
  return AGENT_COLORS[(idx >= 0 ? idx : 0) % AGENT_COLORS.length];
}

const KIND_PILL: Record<AgentKind, { label: string; bg: string; color: string }> = {
  host: { label: 'ON-PREM', bg: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
  cloud: { label: 'CLOUD', bg: 'var(--surface-coral-soft)', color: 'var(--accent)' },
};

function pillStyle(bg: string, color: string): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.3,
    padding: '1px 6px',
    borderRadius: 9999,
    background: bg,
    color,
  };
}

export function ObservabilityContent({
  initialView = 'logs',
  className,
  style,
  agentHostId: propAgentHostId,
  agentHostName: propAgentHostName,
}: ObservabilityContentProps) {
  const scoped = propAgentHostId != null;
  const [view, setView] = useState<ObservabilityView>(initialView);

  // Directory: self-hosted hosts + cloud agents, merged into one list.
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [cloudAgentList, setCloudAgentList] = useState<{ ref: string; name: string }[]>([]);
  const [dirLoading, setDirLoading] = useState(true);
  const [dirError, setDirError] = useState<string | null>(null);

  const [selectedKeySet, setSelectedKeySet] = useState<Set<string>>(
    scoped ? new Set([`host:${propAgentHostId}`]) : new Set()
  );

  // Log streaming state (self-hosted hosts push live logs over the relay).
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [logLevel, setLogLevel] = useState<string>('all');
  const [connState, setConnState] = useState<'connecting' | 'connected' | 'offline' | 'disconnected'>('disconnected');
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const gatewaysRef = useRef<Map<number, AgentHostGateway>>(new Map());

  // Diagnostics data (timeline + cloud-derived logs).
  const [eventsByHost, setEventsByHost] = useState<Map<number, ToolAuditEvent[]>>(new Map());
  const [wfListByHost, setWfListByHost] = useState<Map<number, Workflow[]>>(new Map());
  const [cloudEventsByRef, setCloudEventsByRef] = useState<Map<string, ToolAuditEvent[]>>(new Map());
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [timelineViewMode, setTimelineViewMode] = useState<'list' | 'gantt'>('gantt');
  const [categoryFilter, setCategoryFilter] = useState('');

  // ---- Unified directory + selection derivation -----------------------------
  const unifiedAgents: UnifiedAgent[] = scoped
    ? [{ key: `host:${propAgentHostId}`, kind: 'host', hostId: propAgentHostId, name: propAgentHostName ?? `Agent ${propAgentHostId}` }]
    : [
        ...agentHostList.map((h) => ({ key: `host:${h.id}`, kind: 'host' as const, hostId: h.id, name: h.name, online: h.online })),
        ...cloudAgentList.map((a) => ({ key: `cloud:${a.ref}`, kind: 'cloud' as const, cloudRef: a.ref, name: a.name })),
      ];
  const agentByKey = new Map(unifiedAgents.map((a) => [a.key, a]));

  const selectedKeys = scoped
    ? [`host:${propAgentHostId}`]
    : unifiedAgents.map((a) => a.key).filter((k) => selectedKeySet.has(k));
  const selectionKey = selectedKeys.join(',');
  const selectedHostIds = selectedKeys.map((k) => agentByKey.get(k)).filter((a): a is UnifiedAgent => a?.kind === 'host').map((a) => a.hostId!);
  const selectedCloudRefs = selectedKeys.map((k) => agentByKey.get(k)).filter((a): a is UnifiedAgent => a?.kind === 'cloud').map((a) => a.cloudRef!);
  const hostKey = selectedHostIds.join(',');
  const cloudKey = selectedCloudRefs.join(',');
  const hasSelection = selectedKeys.length > 0;
  const nameForKey = (key: string) => agentByKey.get(key)?.name ?? key;

  // ---- Load the directory ---------------------------------------------------
  useEffect(() => {
    if (scoped) return;
    setDirLoading(true);
    setDirError(null);
    Promise.all([
      agentHosts.list().catch((e) => {
        setDirError(e instanceof Error ? e.message : 'Failed to load agents');
        return [] as AgentHost[];
      }),
      // Registered workforce cloud agents (may not have run yet)…
      loadAgentPool().then((p) => p.filter((a) => a.kind === 'workforce')).catch(() => [] as PoolAgent[]),
      // …plus cloud agents that have ACTUALLY run (incl. the gateway-default
      // bucket) — so every cloud run is attributable to a chip, named or not.
      cloudAgentsApi.list().catch(() => [] as { ref: string; name: string }[]),
    ])
      .then(([hosts, pool, ran]) => {
        setAgentHostList(hosts);
        // Merge by ref; a "ran" entry wins (its name reflects the actual run).
        const byRef = new Map<string, { ref: string; name: string }>();
        for (const a of pool) byRef.set(a.ref, { ref: a.ref, name: a.name });
        for (const a of ran) byRef.set(a.ref, { ref: a.ref, name: a.name });
        setCloudAgentList([...byRef.values()]);
      })
      .finally(() => setDirLoading(false));
  }, [scoped]);

  const toggleAgent = useCallback((key: string) => {
    setSelectedKeySet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedKeySet(new Set(unifiedAgents.map((a) => a.key)));
  // unifiedAgents is derived; selectionKey/list identity covered by deps below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentHostList, cloudAgentList]);

  const clearSelection = useCallback(() => setSelectedKeySet(new Set()), []);

  // ---- Log streaming: connect to each selected HOST, subscribe to logs -------
  useEffect(() => {
    if (selectedHostIds.length === 0) {
      setConnState('disconnected');
      setLogLines([]);
      gatewaysRef.current.forEach((gw) => gw.destroy());
      gatewaysRef.current.clear();
      return;
    }
    setConnState('connecting');
    setLogLines([]);

    const gateways = new Map<number, AgentHostGateway>();
    const connectedIds = new Set<number>();
    const updateConnState = () => setConnState(connectedIds.size > 0 ? 'connected' : 'offline');

    for (const hostId of selectedHostIds) {
      const name = agentByKey.get(`host:${hostId}`)?.name ?? `Agent ${hostId}`;
      const gw = new AgentHostGateway({
        url: agentHosts.wsUrl(hostId),
        onEvent: (ev) => {
          if (ev.type === 'connected' || ev.type === 'agent_host_online') {
            gw.send({ type: 'logs.subscribe' });
            connectedIds.add(hostId);
            updateConnState();
            return;
          }
          if (ev.type === 'agent_host_offline' || ev.type === 'disconnected') {
            connectedIds.delete(hostId);
            updateConnState();
            return;
          }
          if (ev.type !== 'message') return;
          const msg = ev.data as { type?: string; level?: string; message?: string; ts?: string };
          if (msg.type === 'log') {
            setLogLines((prev) => [
              ...prev.slice(-2000),
              {
                ts: msg.ts ?? new Date().toISOString(),
                level: msg.level ?? 'info',
                msg: msg.message ?? '',
                agentKey: `host:${hostId}`,
                agentName: name,
              },
            ]);
          }
        },
      });
      gateways.set(hostId, gw);
    }

    gatewaysRef.current.forEach((gw) => gw.destroy());
    gatewaysRef.current = gateways;

    return () => {
      gateways.forEach((gw) => gw.destroy());
      gatewaysRef.current.clear();
    };
  // hostKey is a stable join-derived key tracking host membership changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostKey]);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll) logEndRef.current?.scrollIntoView();
  }, [logLines, cloudEventsByRef, autoScroll]);

  // ---- Diagnostics loader: host tool-audit + workflows + cloud tool-audit ----
  const loadDiagnostics = useCallback(async () => {
    if (selectedHostIds.length === 0 && selectedCloudRefs.length === 0) return;
    setDiagLoading(true);
    setDiagError(null);
    try {
      const evMap = new Map<number, ToolAuditEvent[]>();
      const wfMap = new Map<number, Workflow[]>();
      const cloudMap = new Map<string, ToolAuditEvent[]>();

      await Promise.all([
        ...selectedHostIds.map(async (hostId) => {
          const [evts, wfsRaw] = await Promise.all([
            agentHosts.toolAuditEvents(hostId, { limit: 200 }),
            workflows.list({ agentHostId: hostId }).catch(() => [] as Workflow[]),
          ]);
          evMap.set(hostId, evts);
          wfMap.set(hostId, await Promise.all(wfsRaw.map((w) => workflows.get(w.id).catch(() => w))));
        }),
        ...selectedCloudRefs.map(async (ref) => {
          cloudMap.set(ref, await cloudAgentsApi.toolAuditEvents(ref, { limit: 200 }).catch(() => [] as ToolAuditEvent[]));
        }),
      ]);

      setEventsByHost(evMap);
      setWfListByHost(wfMap);
      setCloudEventsByRef(cloudMap);
    } catch (e) {
      setDiagError((e as Error).message ?? 'Failed to load diagnostics');
    } finally {
      setDiagLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  // Cloud telemetry feeds BOTH the timeline and the (stream-less) cloud log view,
  // so load it whenever the selection has a cloud agent — in either view. Host
  // timeline data is only needed for the timeline view (host logs come via WS).
  useEffect(() => {
    if (!hasSelection) return;
    if (view === 'timeline' || selectedCloudRefs.length > 0) void loadDiagnostics();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectionKey, loadDiagnostics]);

  // ---- Derive log lines (host WS + cloud telemetry), timeline tracks --------
  const cloudLogLines: LogLine[] = [];
  for (const [ref, evts] of cloudEventsByRef) {
    const name = nameForKey(`cloud:${ref}`);
    for (const ev of evts) {
      const res = (ev.result ?? '').toLowerCase();
      cloudLogLines.push({
        ts: ev.ts,
        level: res.includes('gateway 4') || res.includes('gateway 5') ? 'error' : 'info',
        msg: `${ev.toolName}${ev.category ? ` (${ev.category})` : ''}${ev.durationMs ? ` · ${fmtDuration(ev.durationMs)}` : ''}${ev.result ? ` — ${ev.result}` : ''}`,
        agentKey: `cloud:${ref}`,
        agentName: name,
      });
    }
  }
  const mergedLogs = [...logLines, ...cloudLogLines].sort((a, b) => a.ts.localeCompare(b.ts));
  const filteredLogs = logLevel === 'all' ? mergedLogs : mergedLogs.filter((l) => l.level === logLevel);

  const tracks: TimelineTrack[] = [];
  const pushToolEvent = (ev: ToolAuditEvent, agentKey: string, agentName: string) => {
    if (categoryFilter && !(ev.category ?? '').includes(categoryFilter)) return;
    const startMs = new Date(ev.ts).getTime();
    tracks.push({
      label: ev.category ? `${ev.toolName} (${ev.category})` : ev.toolName,
      kind: 'tool',
      startMs,
      endMs: startMs + (ev.durationMs ?? 0),
      status: 'completed',
      detail: ev.result ? truncate(ev.result, 120) : ev.args ? truncate(ev.args, 120) : undefined,
      agentKey,
      agentName,
    });
  };
  for (const [hostId, evts] of eventsByHost) {
    const key = `host:${hostId}`;
    const name = nameForKey(key);
    for (const ev of evts) pushToolEvent(ev, key, name);
  }
  for (const [ref, evts] of cloudEventsByRef) {
    const key = `cloud:${ref}`;
    const name = nameForKey(key);
    for (const ev of evts) pushToolEvent(ev, key, name);
  }
  for (const [hostId, wfList] of wfListByHost) {
    const key = `host:${hostId}`;
    const name = nameForKey(key);
    for (const wf of wfList) {
      if (!wf.tasks) continue;
      for (const t of wf.tasks) {
        const startMs = t.startedAt ? new Date(t.startedAt).getTime() : new Date(t.createdAt).getTime();
        const endMs = t.completedAt ? new Date(t.completedAt).getTime() : startMs + 1;
        tracks.push({
          label: `${t.agentRole}: ${truncate(t.description, 60)}`,
          kind: 'workflow-task',
          startMs,
          endMs,
          status: t.status,
          detail: t.output ? truncate(t.output, 120) : undefined,
          agentKey: key,
          agentName: name,
        });
      }
    }
  }
  tracks.sort((a, b) => a.startMs - b.startMs);

  const hasCloudSelection = selectedCloudRefs.length > 0;
  const hasHostSelection = selectedHostIds.length > 0;

  // --------------------------------------------------------------------------
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 20, ...style }}>
      {/* Unified agent directory */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Agents</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Click an agent to view its diagnostics. Select more than one to compare.
          </span>
          {!scoped && unifiedAgents.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <button type="button" onClick={selectAll} style={smallBtn}>Select all</button>
              <button type="button" onClick={clearSelection} style={smallBtn}>Clear</button>
            </div>
          )}
        </div>

        {scoped ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {propAgentHostName ?? `Agent ${propAgentHostId}`} (scoped from panel)
          </div>
        ) : dirLoading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading agents…</div>
        ) : unifiedAgents.length === 0 ? (
          <div style={emptyBox}>
            {dirError ? (
              <span>{dirError}</span>
            ) : (
              <>
                No agents yet. Register a self-hosted agent in{' '}
                <Link href="/workforce" style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>Workforce</Link>{' '}
                or create a cloud agent — both appear here once they run.
              </>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {unifiedAgents.map((a) => {
              const checked = selectedKeySet.has(a.key);
              const pill = KIND_PILL[a.kind];
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => toggleAgent(a.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    background: checked ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
                    border: `1px solid ${checked ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 13,
                    color: checked ? 'var(--coral-bright)' : 'var(--text-secondary)',
                  }}
                >
                  {checked && (
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: colorForKey(selectedKeys, a.key), flexShrink: 0 }} />
                  )}
                  {a.name}
                  <span style={pillStyle(pill.bg, pill.color)}>{pill.label}</span>
                  {a.kind === 'host' && (
                    <span
                      style={pillStyle(
                        a.online ? 'rgba(34,197,94,0.15)' : 'var(--bg-elevated)',
                        a.online ? 'rgba(34,197,94,0.95)' : 'var(--text-muted)'
                      )}
                    >
                      {a.online ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Single view toggle — diagnostics as a log view or a timeline view */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>View:</span>
        <button type="button" onClick={() => setView('logs')} style={toggleBtn(view === 'logs')}>Log view</button>
        <button type="button" onClick={() => setView('timeline')} style={toggleBtn(view === 'timeline')}>Timeline view</button>
      </div>

      {/* LOG VIEW */}
      {view === 'logs' && (
        <div style={cardStyle}>
          {hasSelection && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {hasHostSelection && (
                <>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background:
                        connState === 'connected'
                          ? 'var(--green, #22c55e)'
                          : connState === 'offline'
                            ? 'var(--red, #ef4444)'
                            : 'var(--text-muted)',
                    }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{connState}</span>
                </>
              )}
              {hasCloudSelection && (
                <button type="button" onClick={() => void loadDiagnostics()} disabled={diagLoading} style={smallBtn}>
                  {diagLoading ? 'Refreshing…' : 'Refresh cloud'}
                </button>
              )}
              <Select value={logLevel} onChange={(e) => setLogLevel(e.target.value)} style={selectStyle}>
                <option value="all">all</option>
                <option value="error">error</option>
                <option value="warn">warn</option>
                <option value="info">info</option>
                <option value="debug">debug</option>
              </Select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
                Auto-scroll
              </label>
              <button type="button" onClick={() => setLogLines([])} style={smallBtn}>Clear</button>
            </div>
          )}
          {hasCloudSelection && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              Cloud agents run server-side via the gateway (no live relay stream); their log lines are
              derived from execution telemetry. Use “Refresh cloud” for the latest.
            </div>
          )}
          <div style={logPaneStyle}>
            {!hasSelection ? (
              <div style={{ color: 'var(--text-muted)' }}>
                {unifiedAgents.length === 0 && !dirLoading
                  ? 'Register or create an agent first, then select it above.'
                  : 'Select one or more agents above to view diagnostics.'}
              </div>
            ) : filteredLogs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>Waiting for log output…</div>
            ) : (
              filteredLogs.map((l, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: 4,
                    color:
                      l.level === 'error'
                        ? 'var(--red, #ef4444)'
                        : l.level === 'warn'
                          ? 'var(--amber, #f59e0b)'
                          : 'var(--text-secondary)',
                  }}
                >
                  <span style={{ opacity: 0.5, marginRight: 8 }}>{l.ts.slice(11, 19)}</span>
                  <span
                    style={{
                      display: 'inline-block',
                      marginRight: 8,
                      padding: '1px 6px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      background: colorForKey(selectedKeys, l.agentKey),
                      color: '#fff',
                      opacity: 0.9,
                    }}
                  >
                    {l.agentName}
                  </span>
                  <span style={{ minWidth: 40, display: 'inline-block', marginRight: 8, textTransform: 'uppercase', fontSize: 10, opacity: 0.7 }}>
                    {l.level}
                  </span>
                  {l.msg}
                </div>
              ))
            )}
            <div ref={logEndRef} style={{ height: 1 }} />
          </div>
        </div>
      )}

      {/* TIMELINE VIEW */}
      {view === 'timeline' && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Timeline</div>
          {hasSelection ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Category filter (e.g. llm, thinking)"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{ ...selectStyle, width: 200 }}
                />
                <button type="button" onClick={() => void loadDiagnostics()} disabled={diagLoading} style={toggleBtn(true)}>
                  {diagLoading ? 'Loading…' : 'Refresh'}
                </button>
                <button type="button" onClick={() => setTimelineViewMode(timelineViewMode === 'list' ? 'gantt' : 'list')} style={smallBtn}>
                  {timelineViewMode === 'list' ? 'Gantt' : 'List'}
                </button>
              </div>
              <div style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 24, minHeight: 240, overflow: 'auto' }}>
                {diagError ? (
                  <div style={{ color: 'var(--red, #ef4444)', fontSize: 13 }}>{diagError}</div>
                ) : diagLoading && tracks.length === 0 ? (
                  <div style={centerMuted}>Loading timeline…</div>
                ) : tracks.length === 0 ? (
                  <div style={{ ...centerMuted, flexDirection: 'column', gap: 8 }}>
                    <div>No timeline events</div>
                    <div style={{ fontSize: 12 }}>Tool-call audit events and workflow tasks appear here once the agents run.</div>
                  </div>
                ) : timelineViewMode === 'list' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {tracks.map((t, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background:
                              t.kind === 'tool'
                                ? 'var(--accent, #6366f1)'
                                : t.status === 'completed'
                                  ? 'var(--green, #22c55e)'
                                  : t.status === 'failed'
                                    ? 'var(--red, #ef4444)'
                                    : t.status === 'running'
                                      ? 'var(--blue, #3b82f6)'
                                      : 'var(--text-muted)',
                            marginTop: 5,
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: colorForKey(selectedKeys, t.agentKey), color: '#fff', flexShrink: 0 }}>
                              {t.agentName}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{t.label}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {fmtTime(t.startMs)}
                            {t.endMs > t.startMs ? ` → ${fmtTime(t.endMs)} (${fmtDuration(t.endMs - t.startMs)})` : ''}
                          </div>
                          {t.detail && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{t.detail}</div>
                          )}
                        </div>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--bg-deep)', color: 'var(--text-secondary)', flexShrink: 0 }}>
                          {t.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ExecutionTimelineChart tracks={tracks} colorForKey={(k) => colorForKey(selectedKeys, k)} />
                )}
              </div>
            </>
          ) : (
            <div style={{ ...centerMuted, flexDirection: 'column', minHeight: 240, gap: 8 }}>
              {unifiedAgents.length === 0 && !dirLoading ? (
                <>
                  <span>Register or create an agent first.</span>
                  <Link href="/workforce" style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>Go to Workforce →</Link>
                </>
              ) : (
                <span>Select one or more agents above to view the execution timeline.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- shared inline style helpers (kept local; this is the only consumer) -----
const smallBtn: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  background: 'var(--bg-deep)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

const selectStyle: React.CSSProperties = {
  height: 28,
  padding: '3px 8px',
  fontSize: 12,
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
};

const emptyBox: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-muted)',
  padding: 12,
  background: 'var(--bg-deep)',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
};

const logPaneStyle: React.CSSProperties = {
  background: 'var(--bg-deep)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  padding: 12,
  minHeight: 280,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--text-muted)',
  overflow: 'auto',
};

const centerMuted: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-muted)',
  fontSize: 13,
};

function toggleBtn(active: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 600,
    background: active ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
    color: active ? 'var(--coral-bright)' : 'var(--text-secondary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 8,
    cursor: 'pointer',
  };
}

