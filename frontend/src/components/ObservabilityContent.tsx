'use client';

import Link from 'next/link';
import { useState, useEffect, useRef, useCallback } from 'react';
import { agentHosts, workflows, type AgentHost, type ToolAuditEvent, type Workflow } from '@/lib/builderforceApi';
import { AgentHostGateway } from '@/lib/agentHostGateway';

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

interface LogLine {
  ts: string;
  level: string;
  msg: string;
  agentHostId: number;
  agentHostName: string;
}

interface TimelineTrack {
  label: string;
  kind: 'tool' | 'workflow-task';
  startMs: number;
  endMs: number;
  status: string;
  detail?: string;
  agentHostId: number;
  agentHostName: string;
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

const AGENT_HOST_COLORS = [
  'var(--coral-bright, #f97316)',
  'var(--accent, #6366f1)',
  'var(--green, #22c55e)',
  'var(--blue, #3b82f6)',
  'var(--amber, #f59e0b)',
];

function agentHostColor(index: number): string {
  return AGENT_HOST_COLORS[index % AGENT_HOST_COLORS.length];
}

export function ObservabilityContent({
  initialView = 'logs',
  className,
  style,
  agentHostId: propAgentHostId,
  agentHostName: propAgentHostName,
}: ObservabilityContentProps) {
  const [view, setView] = useState<ObservabilityView>(initialView);
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [agentHostListLoading, setAgentHostListLoading] = useState(true);
  const [agentHostListError, setAgentHostListError] = useState<string | null>(null);
  const [selectedAgentHostIds, setSelectedAgentHostIds] = useState<Set<number>>(
    propAgentHostId != null ? new Set([propAgentHostId]) : new Set()
  );
  const selectedIds = propAgentHostId != null ? [propAgentHostId] : Array.from(selectedAgentHostIds);
  const selectedIdsKey = selectedIds.join(',');

  // Log streaming state
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [logLevel, setLogLevel] = useState<string>('all');
  const [connState, setConnState] = useState<'connecting' | 'connected' | 'offline' | 'disconnected'>('disconnected');
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const gatewaysRef = useRef<Map<number, AgentHostGateway>>(new Map());

  // Timeline state
  const [eventsByAgentHost, setEventsByAgentHost] = useState<Map<number, ToolAuditEvent[]>>(new Map());
  const [wfListByAgentHost, setWfListByAgentHost] = useState<Map<number, Workflow[]>>(new Map());
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineViewMode, setTimelineViewMode] = useState<'list' | 'timeline'>('list');
  const [categoryFilter, setCategoryFilter] = useState('');

  const agentHostById = useRef<Map<number, AgentHost>>(new Map());
  agentHostById.current = new Map(agentHostList.map((c) => [c.id, c]));

  // Load agentHosts when no propAgentHostId
  useEffect(() => {
    if (propAgentHostId != null) return;
    setAgentHostListLoading(true);
    setAgentHostListError(null);
    agentHosts
      .list()
      .then((list) => {
        setAgentHostList(list);
        setAgentHostListError(null);
      })
      .catch((e) => {
        setAgentHostList([]);
        setAgentHostListError(e instanceof Error ? e.message : 'Failed to load agents');
      })
      .finally(() => setAgentHostListLoading(false));
  }, [propAgentHostId]);

  const toggleAgentHost = useCallback((id: number) => {
    setSelectedAgentHostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllAgentHosts = useCallback(() => {
    setSelectedAgentHostIds(new Set(agentHostList.map((c) => c.id)));
  }, [agentHostList]);

  const clearAgentHosts = useCallback(() => {
    setSelectedAgentHostIds(new Set());
  }, []);

  // Log streaming: connect to each selected agentHost WS, subscribe to logs
  useEffect(() => {
    if (selectedIds.length === 0) {
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

    const updateConnState = () => {
      setConnState(connectedIds.size > 0 ? 'connected' : 'offline');
    };

    for (const agentHostId of selectedIds) {
      const agentHost = agentHostById.current.get(agentHostId);
      const agentHostName = agentHost?.name ?? `AgentHost ${agentHostId}`;
      const url = agentHosts.wsUrl(agentHostId);
      const gw = new AgentHostGateway({
        url,
        onEvent: (ev) => {
          if (ev.type === 'connected' || ev.type === 'agent_host_online') {
            gw.send({ type: 'logs.subscribe' });
            connectedIds.add(agentHostId);
            updateConnState();
            return;
          }
          if (ev.type === 'agent_host_offline' || ev.type === 'disconnected') {
            connectedIds.delete(agentHostId);
            updateConnState();
            return;
          }
          if (ev.type !== 'message') return;
          const msg = ev.data as { type?: string; level?: string; message?: string; ts?: string };
          if (msg.type === 'log') {
            setLogLines((prev) =>
              [
                ...prev.slice(-2000),
                {
                  ts: msg.ts ?? new Date().toISOString(),
                  level: msg.level ?? 'info',
                  msg: msg.message ?? '',
                  agentHostId,
                  agentHostName,
                },
              ]
            );
          }
        },
      });
      gateways.set(agentHostId, gw);
    }

    gatewaysRef.current.forEach((gw) => gw.destroy());
    gatewaysRef.current = gateways;

    return () => {
      gateways.forEach((gw) => gw.destroy());
      gatewaysRef.current.clear();
    };
  // selectedIds is intentionally omitted: selectedIdsKey is a stable join-derived key that
  // tracks membership changes without array reference equality issues.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdsKey]);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll) logEndRef.current?.scrollIntoView();
  }, [logLines, autoScroll]);

  // Timeline: fetch tool-audit and workflows from all selected agentHosts
  const loadTimeline = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const evMap = new Map<number, ToolAuditEvent[]>();
      const wfMap = new Map<number, Workflow[]>();

      await Promise.all(
        selectedIds.map(async (agentHostId) => {
          const [evts, wfsRaw] = await Promise.all([
            agentHosts.toolAuditEvents(agentHostId, { limit: 200 }),
            workflows.list({ agentHostId }).catch(() => [] as Workflow[]),
          ]);
          evMap.set(agentHostId, evts);
          const wfs = await Promise.all(wfsRaw.map((w) => workflows.get(w.id).catch(() => w)));
          wfMap.set(agentHostId, wfs);
        })
      );

      setEventsByAgentHost(evMap);
      setWfListByAgentHost(wfMap);
    } catch (e) {
      setTimelineError((e as Error).message ?? 'Failed to load timeline');
    } finally {
      setTimelineLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdsKey]);

  useEffect(() => {
    if (view === 'timeline' && selectedIds.length > 0) {
      void loadTimeline();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedIdsKey, loadTimeline]);

  const filteredLogs =
    logLevel === 'all' ? logLines : logLines.filter((l) => l.level === logLevel);

  // Build timeline tracks from all agentHosts, tagged by agentHost
  const tracks: TimelineTrack[] = [];
  for (const [agentHostId, evts] of eventsByAgentHost) {
    const agentHost = agentHostById.current.get(agentHostId);
    const agentHostName = agentHost?.name ?? `AgentHost ${agentHostId}`;
    for (const ev of evts) {
      if (categoryFilter && !(ev.category ?? '').includes(categoryFilter)) continue;
      const startMs = new Date(ev.ts).getTime();
      const endMs = startMs + (ev.durationMs ?? 0);
      tracks.push({
        label: ev.category ? `${ev.toolName} (${ev.category})` : ev.toolName,
        kind: 'tool',
        startMs,
        endMs,
        status: 'completed',
        detail: ev.args ? truncate(ev.args, 120) : undefined,
        agentHostId,
        agentHostName,
      });
    }
  }
  for (const [agentHostId, wfList] of wfListByAgentHost) {
    const agentHost = agentHostById.current.get(agentHostId);
    const agentHostName = agentHost?.name ?? `AgentHost ${agentHostId}`;
    for (const wf of wfList) {
      if (!wf.tasks) continue;
      for (const t of wf.tasks) {
        const startMs = t.startedAt
          ? new Date(t.startedAt).getTime()
          : new Date(t.createdAt).getTime();
        const endMs = t.completedAt ? new Date(t.completedAt).getTime() : startMs + 1;
        tracks.push({
          label: `${t.agentRole}: ${truncate(t.description, 60)}`,
          kind: 'workflow-task',
          startMs,
          endMs,
          status: t.status,
          detail: t.output ? truncate(t.output, 120) : undefined,
          agentHostId,
          agentHostName,
        });
      }
    }
  }
  tracks.sort((a, b) => a.startMs - b.startMs);

  const hasSelection = selectedIds.length > 0;

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: 20, ...style }}
    >
      {/* Active AgentHost — above tabs */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Active Agents
          </span>
          {propAgentHostId == null && agentHostList.length > 0 && (
            <>
              <button
                type="button"
                onClick={selectAllAgentHosts}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  background: 'var(--bg-deep)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearAgentHosts}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  background: 'var(--bg-deep)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </>
          )}
        </div>
        {propAgentHostId != null ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {propAgentHostName ?? `AgentHost ${propAgentHostId}`} (scoped from panel)
          </div>
        ) : agentHostListLoading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading agents…</div>
        ) : agentHostList.length === 0 ? (
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              padding: 12,
              background: 'var(--bg-deep)',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
            }}
          >
            {agentHostListError ? (
              <span>{agentHostListError}</span>
            ) : (
              <>
                No agents connected. Register a BuilderForce Agents instance in{' '}
                <Link href="/workforce" style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>
                  Workforce
                </Link>{' '}
                and connect it with the API key.
              </>
            )}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {agentHostList.map((c, idx) => {
              const checked = selectedAgentHostIds.has(c.id);
              return (
                <label
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    background: checked ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
                    border: `1px solid ${checked ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 13,
                    color: checked ? 'var(--coral-bright)' : 'var(--text-secondary)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAgentHost(c.id)}
                    style={{ accentColor: 'var(--coral-bright)' }}
                  />
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: agentHostColor(idx),
                      flexShrink: 0,
                    }}
                  />
                  {c.name} ({c.id})
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Tabs — views into selected agents */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>View:</span>
        <button
          type="button"
          onClick={() => setView('logs')}
          style={{
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 600,
            background: view === 'logs' ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
            color: view === 'logs' ? 'var(--coral-bright)' : 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Logs
        </button>
        <button
          type="button"
          onClick={() => setView('timeline')}
          style={{
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 600,
            background: view === 'timeline' ? 'var(--surface-coral-soft)' : 'var(--bg-deep)',
            color: view === 'timeline' ? 'var(--coral-bright)' : 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Timeline
        </button>
      </div>

      {/* Content — Logs or Timeline */}
      {view === 'logs' && (
        <div style={cardStyle}>
          {hasSelection && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
                flexWrap: 'wrap',
              }}
            >
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
              <select
                value={logLevel}
                onChange={(e) => setLogLevel(e.target.value)}
                style={{
                  height: 28,
                  padding: '3px 8px',
                  fontSize: 12,
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  background: 'var(--bg-deep)',
                  color: 'var(--text-primary)',
                  width: 100,
                }}
              >
                <option value="all">all</option>
                <option value="error">error</option>
                <option value="warn">warn</option>
                <option value="info">info</option>
                <option value="debug">debug</option>
              </select>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                />
                Auto-scroll
              </label>
              <button
                type="button"
                onClick={() => setLogLines([])}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  background: 'var(--bg-deep)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          )}
          <div
            style={{
              background: 'var(--bg-deep)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: 12,
              minHeight: 280,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-muted)',
              overflow: 'auto',
            }}
          >
            {!hasSelection ? (
              <div style={{ color: 'var(--text-muted)' }}>
                {agentHostList.length === 0 && !agentHostListLoading
                  ? 'Register an agent in Workforce first, then select above.'
                  : 'Select one or more agents above to stream logs.'}
              </div>
            ) : filteredLogs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>
                Waiting for log output…
              </div>
            ) : (
              filteredLogs.map((l, i) => {
                const agentHostIdx = selectedIds.indexOf(l.agentHostId);
                const color = agentHostColor(agentHostIdx >= 0 ? agentHostIdx : 0);
                return (
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
                    <span style={{ opacity: 0.5, marginRight: 8 }}>
                      {l.ts.slice(11, 19)}
                    </span>
                    <span
                      style={{
                        display: 'inline-block',
                        marginRight: 8,
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: color,
                        color: '#fff',
                        opacity: 0.9,
                      }}
                    >
                      {l.agentHostName}
                    </span>
                    <span
                      style={{
                        minWidth: 40,
                        display: 'inline-block',
                        marginRight: 8,
                        textTransform: 'uppercase',
                        fontSize: 10,
                        opacity: 0.7,
                      }}
                    >
                      {l.level}
                    </span>
                    {l.msg}
                  </div>
                );
              })
            )}
            <div ref={logEndRef} style={{ height: 1 }} />
          </div>
        </div>
      )}

      {view === 'timeline' && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Timeline</div>
          {hasSelection && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 12,
                  flexWrap: 'wrap',
                }}
              >
                <input
                  type="text"
                  placeholder="Category filter (e.g. thinking)"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    fontSize: 12,
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    background: 'var(--bg-deep)',
                    color: 'var(--text-primary)',
                    width: 200,
                  }}
                />
                <button
                  type="button"
                  onClick={() => void loadTimeline()}
                  disabled={timelineLoading}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    background: 'var(--surface-coral-soft)',
                    color: 'var(--coral-bright)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    cursor: timelineLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {timelineLoading ? 'Loading…' : 'Refresh'}
                </button>
                <button
                  type="button"
                  onClick={() => setTimelineViewMode(timelineViewMode === 'list' ? 'timeline' : 'list')}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    background: 'var(--bg-deep)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  {timelineViewMode === 'list' ? 'Timeline' : 'List'}
                </button>
              </div>
              <div
                style={{
                  background: 'var(--bg-deep)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: 24,
                  minHeight: 240,
                  overflow: 'auto',
                }}
              >
                {timelineError ? (
                  <div style={{ color: 'var(--red, #ef4444)', fontSize: 13 }}>{timelineError}</div>
                ) : timelineLoading && tracks.length === 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                      fontSize: 13,
                    }}
                  >
                    Loading timeline…
                  </div>
                ) : tracks.length === 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)',
                      fontSize: 13,
                      gap: 8,
                    }}
                  >
                    <div>No timeline events</div>
                    <div style={{ fontSize: 12 }}>
                      Tool audit events and workflow tasks will appear here once the agentHosts run.
                    </div>
                  </div>
                ) : timelineViewMode === 'list' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {tracks.map((t, i) => {
                      const agentHostIdx = selectedIds.indexOf(t.agentHostId);
                      const color = agentHostColor(agentHostIdx >= 0 ? agentHostIdx : 0);
                      return (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            padding: '10px 14px',
                            background: 'var(--bg-base)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 8,
                          }}
                        >
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
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                marginBottom: 2,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  background: color,
                                  color: '#fff',
                                  flexShrink: 0,
                                }}
                              >
                                {t.agentHostName}
                              </span>
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: 500,
                                  color: 'var(--text-primary)',
                                }}
                              >
                                {t.label}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: 'var(--text-muted)',
                                marginTop: 2,
                              }}
                            >
                              {fmtTime(t.startMs)}
                              {t.endMs > t.startMs
                                ? ` → ${fmtTime(t.endMs)} (${fmtDuration(t.endMs - t.startMs)})`
                                : ''}
                            </div>
                            {t.detail && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: 'var(--text-muted)',
                                  marginTop: 4,
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {t.detail}
                              </div>
                            )}
                          </div>
                          <span
                            style={{
                              fontSize: 11,
                              padding: '2px 8px',
                              borderRadius: 6,
                              background: 'var(--bg-deep)',
                              color: 'var(--text-secondary)',
                              flexShrink: 0,
                            }}
                          >
                            {t.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <TimelineBarView tracks={tracks} selectedIds={selectedIds} agentHostById={agentHostById.current} />
                )}
              </div>
            </>
          )}
          {!hasSelection && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 240,
                color: 'var(--text-muted)',
                fontSize: 13,
                gap: 8,
              }}
            >
              {agentHostList.length === 0 && !agentHostListLoading ? (
                <>
                  <span>Register an agent in Workforce first.</span>
                  <Link href="/workforce" style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>
                    Go to Workforce →
                  </Link>
                </>
              ) : (
                <span>Select one or more agents above to view execution timeline.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineBarView({
  tracks,
  selectedIds,
  agentHostById,
}: {
  tracks: TimelineTrack[];
  selectedIds: number[];
  agentHostById: Map<number, AgentHost>;
}) {
  const minMs = Math.min(...tracks.map((t) => t.startMs));
  const maxMs = Math.max(...tracks.map((t) => t.endMs || t.startMs + 1));
  const totalMs = Math.max(maxMs - minMs, 1);
  const ROW_H = 28;
  const LABEL_W = 220;
  const BAR_W = 400;
  const PAD = 8;
  const totalH = tracks.length * (ROW_H + 4) + PAD * 2;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        width={LABEL_W + BAR_W + PAD * 2}
        height={totalH + 24}
        style={{ fontFamily: 'var(--font-mono, monospace)', display: 'block' }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const ms = minMs + totalMs * pct;
          const x = LABEL_W + pct * BAR_W;
          return (
            <g key={i}>
              <line
                x1={x}
                y1={0}
                x2={x}
                y2={totalH}
                stroke="var(--border-subtle)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text
                x={x}
                y={totalH + 16}
                fontSize={9}
                fill="var(--text-muted)"
                textAnchor="middle"
              >
                {fmtTime(ms)}
              </text>
            </g>
          );
        })}
        {tracks.map((t, i) => {
          const y = PAD + i * (ROW_H + 4);
          const barX = LABEL_W + ((t.startMs - minMs) / totalMs) * BAR_W;
          const barW = Math.max(((t.endMs - t.startMs) / totalMs) * BAR_W, 4);
          const agentHostIdx = selectedIds.indexOf(t.agentHostId);
          const color =
            t.kind === 'tool'
              ? agentHostIdx >= 0 ? AGENT_HOST_COLORS[agentHostIdx % AGENT_HOST_COLORS.length] : 'var(--accent, #6366f1)'
              : t.status === 'completed'
                ? 'var(--green, #22c55e)'
                : t.status === 'failed'
                  ? 'var(--red, #ef4444)'
                  : t.status === 'running'
                    ? 'var(--blue, #3b82f6)'
                    : 'var(--text-muted)';
          const label = `[${t.agentHostName}] ${truncate(t.label, 20)}`;
          return (
            <g key={i}>
              <text
                x={LABEL_W - 6}
                y={y + ROW_H / 2 + 4}
                fontSize={10}
                fill="var(--text-primary)"
                textAnchor="end"
              >
                {truncate(label, 28)}
              </text>
              <rect
                x={barX}
                y={y}
                width={barW}
                height={ROW_H}
                rx={4}
                fill={color}
                opacity={0.85}
              >
                <title>
                  {t.agentHostName}: {t.label}
                  {'\n'}
                  {fmtTime(t.startMs)} → {fmtTime(t.endMs)}
                  {'\n'}
                  Duration: {fmtDuration(t.endMs - t.startMs)}
                  {t.detail ? `\n${t.detail}` : ''}
                </title>
              </rect>
              <text x={barX + barW + 4} y={y + ROW_H / 2 + 4} fontSize={10} fill="var(--text-muted)">
                {fmtDuration(t.endMs - t.startMs)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
