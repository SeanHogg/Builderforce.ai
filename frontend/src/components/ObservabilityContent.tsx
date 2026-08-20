'use client';

import { Select } from '@/components/Select';
import type { Formatter } from '@/i18n/format';

import Link from 'next/link';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  agentHosts,
  cloudAgents as cloudAgentsApi,
  workflows,
  vscodeConnections,
  isVscodeConnectionOnline,
  type AgentHost,
  type ToolAuditEvent,
  type Workflow,
  type VscodeConnection,
} from '@/lib/builderforceApi';
import { AgentHostGateway } from '@/lib/agentHostGateway';
import { loadAgentPool, type PoolAgent } from '@/lib/agentPool';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { ExecutionTimelineChart } from './ExecutionTimelineChart';
import { useFormat } from "@/i18n/useFormat";

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
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
  /** When set (e.g. from an execution panel), scope observability to this cloud
   *  agent (ide_agents.id, or the '__default__' sentinel). Mutually exclusive
   *  with agentHostId. */
  cloudAgentRef?: string;
  /** Display name for the cloud agent when cloudAgentRef is set. */
  cloudAgentName?: string;
  /** Embedded mode: hide the agent-directory card and the Log/Timeline toggle.
   *  The host page wants both; a panel that already scopes the agent and picks
   *  the view (via its own tabs) doesn't. */
  embedded?: boolean;
  /** When set, scope cloud telemetry to a single execution (precise per-run
   *  Logs/Timeline, robust to later agent re-assignment). */
  executionId?: number;
  /** Optional leading prose injected into the copy-triage report by the embedding
   *  panel — "Review Context" (PR URL, branch, outcome, the model(s) that actually
   *  ran) followed by "Materials & Context" (task + PRD). Telemetry alone isn't
   *  reviewable; this is what points a reviewer at the real code and the real model. */
  reportMaterials?: string;
  /** Optional async builder for the "Code Changes (transaction)" section — the
   *  actual file diffs the run produced. Awaited when the user copies the report. */
  reportTransaction?: () => Promise<string>;
}

/** Self-hosted hosts, cloud agents, and connected VS Code editors — one unified
 *  directory. VS Code connections are presence-only (no tool-audit telemetry, so no
 *  timeline tracks); they appear as directory chips with a live/offline pill. */
type AgentKind = 'host' | 'cloud' | 'vscode';

interface UnifiedAgent {
  /** Stable selection key: `host:<id>`, `cloud:<ref>`, or `vscode:<id>`. */
  key: string;
  kind: AgentKind;
  /** agent_hosts.id for kind 'host'. */
  hostId?: number;
  /** ide_agents.id (cloud ref) for kind 'cloud'. */
  cloudRef?: string;
  name: string;
  /** Live-connection status — hosts and vscode connections. */
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

function fmtTime(fmt: Formatter, ms: number): string {
  return fmt.dateWith(ms, {
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

/** A terminal-failure trace event (the `run.failed` events emitted on
 *  orphan-reap / FAILED transition), a tool call that returned a gateway 4xx/5xx,
 *  or a tool whose result reported its own failure (`{"ok":false}` / an `error`
 *  field — e.g. write_file with no repo bound). All three render as error-level
 *  logs and failed (red) timeline tracks, and count toward the triage Errors. */
function isErrorEvent(ev: ToolAuditEvent): boolean {
  const res = (ev.result ?? '').toLowerCase();
  return ev.toolName === 'run.failed'
    || ev.category === 'error'
    || res.includes('gateway 4')
    || res.includes('gateway 5')
    || res.includes('"ok":false')
    || /"error":\s*"[^"]/.test(res);
}

const AGENT_COLORS = [
  'var(--coral-bright)',
  'var(--accent)',
  'var(--success, var(--success))',
  'var(--info)',
  'var(--warning, var(--warning))',
];

/** Stable per-agent color, indexed by position in the current selection. */
function colorForKey(selectedKeys: string[], key: string): string {
  const idx = selectedKeys.indexOf(key);
  return AGENT_COLORS[(idx >= 0 ? idx : 0) % AGENT_COLORS.length];
}

const KIND_PILL: Record<AgentKind, { label: string; bg: string; color: string }> = {
  host: { label: 'ON-PREM', bg: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
  cloud: { label: 'CLOUD', bg: 'var(--surface-coral-soft)', color: 'var(--accent)' },
  vscode: { label: 'VS CODE', bg: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
};

function pillStyle(bg: string, color: string): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.3,
    padding: '1px 6px',
    borderRadius: 'var(--radius-full)',
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
  cloudAgentRef: propCloudAgentRef,
  cloudAgentName: propCloudAgentName,
  embedded = false,
  executionId: propExecutionId,
  reportMaterials,
  reportTransaction,
}: ObservabilityContentProps) {
  const fmt = useFormat();
  const t = useTranslations('observability');
  const tc = useTranslations('common');
  // Scoped mode pins the directory to a single agent (a host OR a cloud agent)
  // instead of showing the full, selectable directory.
  const scopedHostKey = propAgentHostId != null ? `host:${propAgentHostId}` : null;
  const scopedCloudKey = propCloudAgentRef != null ? `cloud:${propCloudAgentRef}` : null;
  const scopedKey = scopedHostKey ?? scopedCloudKey;
  const scoped = scopedKey != null;
  const [view, setView] = useState<ObservabilityView>(initialView);

  // Directory: self-hosted hosts + cloud agents, merged into one list.
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [cloudAgentList, setCloudAgentList] = useState<{ ref: string; name: string }[]>([]);
  const [vscodeConnList, setVscodeConnList] = useState<VscodeConnection[]>([]);
  const [dirLoading, setDirLoading] = useState(true);
  const [dirError, setDirError] = useState<string | null>(null);

  const [selectedKeySet, setSelectedKeySet] = useState<Set<string>>(
    scopedKey ? new Set([scopedKey]) : new Set()
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
  // Triage capture: "Copied" / "Failed" flash after the copy button is pressed. The
  // write, that flash and its 2000ms reset are the shared hook's (same states, same
  // window as the local enum it replaces).
  const triageCopy = useCopyToClipboard();

  // ---- Unified directory + selection derivation -----------------------------
  const scopedAgent: UnifiedAgent | null = scopedHostKey != null
    ? { key: scopedHostKey, kind: 'host', hostId: propAgentHostId, name: propAgentHostName ?? t('agentNumbered', { id: String(propAgentHostId ?? '') }) }
    : scopedCloudKey != null
      ? { key: scopedCloudKey, kind: 'cloud', cloudRef: propCloudAgentRef, name: propCloudAgentName ?? t('cloudAgentFallback') }
      : null;
  const unifiedAgents: UnifiedAgent[] = scopedAgent
    ? [scopedAgent]
    : [
        ...agentHostList.map((h) => ({ key: `host:${h.id}`, kind: 'host' as const, hostId: h.id, name: h.name, online: h.online })),
        ...cloudAgentList.map((a) => ({ key: `cloud:${a.ref}`, kind: 'cloud' as const, cloudRef: a.ref, name: a.name })),
        ...vscodeConnList.map((c) => ({ key: `vscode:${c.id}`, kind: 'vscode' as const, name: c.machineName, online: isVscodeConnectionOnline(c) })),
      ];
  const agentByKey = new Map(unifiedAgents.map((a) => [a.key, a]));

  const selectedKeys = scopedKey
    ? [scopedKey]
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
        setDirError(e instanceof Error ? e.message : t('errLoadAgents'));
        return [] as AgentHost[];
      }),
      // Registered workforce cloud agents (may not have run yet)…
      loadAgentPool().then((p) => p.filter((a) => a.kind === 'workforce')).catch(() => [] as PoolAgent[]),
      // …plus cloud agents that have ACTUALLY run (incl. the gateway-default
      // bucket) — so every cloud run is attributable to a chip, named or not.
      cloudAgentsApi.list().catch(() => [] as { ref: string; name: string }[]),
      // Connected VS Code editors — presence chips (no telemetry / timeline).
      vscodeConnections.list().catch(() => [] as VscodeConnection[]),
    ])
      .then(([hosts, pool, ran, vscode]) => {
        setAgentHostList(hosts);
        // Merge by ref; a "ran" entry wins (its name reflects the actual run).
        const byRef = new Map<string, { ref: string; name: string }>();
        for (const a of pool) byRef.set(a.ref, { ref: a.ref, name: a.name });
        for (const a of ran) byRef.set(a.ref, { ref: a.ref, name: a.name });
        setCloudAgentList([...byRef.values()]);
        setVscodeConnList(vscode);
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
      // String, not number: an ICU number arg would gain a locale thousands separator
      // ("Agent 1,234") where the old template literal produced the raw id.
      const name = agentByKey.get(`host:${hostId}`)?.name ?? t('agentNumbered', { id: String(hostId) });
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
          cloudMap.set(ref, await cloudAgentsApi.toolAuditEvents(ref, { limit: 200, executionId: propExecutionId }).catch(() => [] as ToolAuditEvent[]));
        }),
      ]);

      setEventsByHost(evMap);
      setWfListByHost(wfMap);
      setCloudEventsByRef(cloudMap);
    } catch (e) {
      setDiagError((e as Error).message ?? t('errLoadDiagnostics'));
    } finally {
      setDiagLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, propExecutionId]);

  // Cloud telemetry feeds BOTH the timeline and the (stream-less) cloud log view,
  // so load it whenever the selection has a cloud agent — in either view. Host
  // timeline data is only needed for the timeline view (host logs come via WS).
  useEffect(() => {
    if (!hasSelection) return;
    if (view === 'timeline' || selectedCloudRefs.length > 0) void loadDiagnostics();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectionKey, loadDiagnostics]);

  // Embedded in an execution panel, the diagnostics must stay live as the run
  // emits events (the host page refreshes manually). Poll while embedded so the
  // Logs/Timeline keep parity with the auto-polling Tools tab next to them.
  useEffect(() => {
    if (!embedded || !hasSelection) return;
    const poll = setInterval(() => { void loadDiagnostics(); }, 5000);
    return () => clearInterval(poll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, selectionKey, loadDiagnostics]);

  // ---- Derive log lines (host WS + cloud telemetry), timeline tracks --------
  const cloudLogLines: LogLine[] = [];
  for (const [ref, evts] of cloudEventsByRef) {
    const name = nameForKey(`cloud:${ref}`);
    for (const ev of evts) {
      cloudLogLines.push({
        ts: ev.ts,
        level: isErrorEvent(ev) ? 'error' : 'info',
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
      status: isErrorEvent(ev) ? 'failed' : 'completed',
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
      for (const task of wf.tasks) {
        const startMs = task.startedAt ? new Date(task.startedAt).getTime() : new Date(task.createdAt).getTime();
        const endMs = task.completedAt ? new Date(task.completedAt).getTime() : startMs + 1;
        tracks.push({
          label: `${task.agentRole}: ${truncate(task.description, 60)}`,
          kind: 'workflow-task',
          startMs,
          endMs,
          status: task.status,
          detail: task.output ? truncate(task.output, 120) : undefined,
          agentKey: key,
          agentName: name,
        });
      }
    }
  }
  tracks.sort((a, b) => a.startMs - b.startMs);

  const hasCloudSelection = selectedCloudRefs.length > 0;
  const hasHostSelection = selectedHostIds.length > 0;

  // ---- Triage capture -------------------------------------------------------
  // Assemble a single paste-able report of everything this view holds about the
  // run — selected agents, every telemetry event (full args/results), the derived
  // logs, and an errors-first summary — so it can be dropped straight into a bug
  // report. Built from the same data the Logs/Timeline render, so it stays in sync.
  const buildTriageReport = (extraSections: string[] = []): string => {
    const cap = (s: unknown, n = 2000): string => {
      const str = typeof s === 'string' ? s : JSON.stringify(s ?? '');
      return str.length > n ? str.slice(0, n) + `… (+${str.length - n} chars)` : str;
    };
    const flatEvents: Array<{ ev: ToolAuditEvent; agentName: string }> = [];
    for (const [hostId, evts] of eventsByHost) for (const ev of evts) flatEvents.push({ ev, agentName: nameForKey(`host:${hostId}`) });
    for (const [ref, evts] of cloudEventsByRef) for (const ev of evts) flatEvents.push({ ev, agentName: nameForKey(`cloud:${ref}`) });
    flatEvents.sort((a, b) => a.ev.ts.localeCompare(b.ev.ts));

    const errors = flatEvents.filter((e) => isErrorEvent(e.ev));
    const lines: string[] = [];
    lines.push('=== BuilderForce Execution Triage ===');
    lines.push(`Captured:  ${new Date().toISOString()}`);
    if (propExecutionId != null) lines.push(`Execution: #${propExecutionId}`);
    lines.push(`Agents:    ${selectedKeys.map((k) => `${nameForKey(k)} [${agentByKey.get(k)?.kind ?? '?'}]`).join(', ') || '—'}`);
    if (hasHostSelection) lines.push(`Host link: ${connState}`);
    lines.push(`Events: ${flatEvents.length} · Errors: ${errors.length} · Log lines: ${mergedLogs.length}`);

    // Agent Configuration — surface WHO ran and WITH WHAT config (resolved personas /
    // skills / content + the model decision), parsed from the capabilities.load +
    // model.select + runtime.dispatch telemetry. Without this a triage paste shows
    // the events a run produced but not, say, that a docs/BA persona set was loaded
    // for a coding task, or which model pool the gateway seeded — the exact context a
    // reviewer needs to spot a mis-staffed or mis-routed run.
    const parseArgs = (raw: string | null | undefined): Record<string, unknown> | null => {
      if (!raw) return null;
      try { const v: unknown = JSON.parse(raw); return v && typeof v === 'object' ? (v as Record<string, unknown>) : null; }
      catch { return null; }
    };
    const list = (v: unknown): string => (Array.isArray(v) && v.length ? v.join(', ') : '—');
    const evsByAgent = new Map<string, ToolAuditEvent[]>();
    for (const { ev, agentName } of flatEvents) {
      const arr = evsByAgent.get(agentName) ?? [];
      arr.push(ev);
      evsByAgent.set(agentName, arr);
    }
    const configLines: string[] = [];
    for (const [agentName, evs] of evsByAgent) {
      const argsFor = (tool: string) => parseArgs(evs.find((e) => e.toolName === tool)?.args);
      const dispatch = argsFor('runtime.dispatch');
      const caps = argsFor('capabilities.load');
      const sel = argsFor('model.select');
      if (!dispatch && !caps && !sel) continue;
      configLines.push(`• ${agentName}`);
      if (dispatch) {
        const parts = [dispatch.agentType, dispatch.engine && `engine=${dispatch.engine}`,
          dispatch.surface && `surface=${dispatch.surface}`, dispatch.executor && `executor=${dispatch.executor}`,
          dispatch.model && `model=${dispatch.model}`].filter(Boolean);
        if (parts.length) configLines.push(`    dispatch:   ${parts.join(' · ')}`);
      }
      if (caps) {
        configLines.push(`    personas:   ${list(caps.personas)}`);
        configLines.push(`    skills:     ${list(caps.skills)}`);
        if (Array.isArray(caps.content) && caps.content.length) configLines.push(`    content:    ${list(caps.content)}`);
        if (Array.isArray(caps.missing) && caps.missing.length) configLines.push(`    missing:    ${list(caps.missing)}`);
      }
      if (sel) {
        configLines.push(`    model.seed: ${sel.seed ?? '—'}${sel.seedIsCoder != null ? ` (coder=${sel.seedIsCoder})` : ''}`
          + ` · requested=${sel.requested ?? 'gateway-default'} · pin=${sel.pin ?? '—'} · plan=${sel.plan ?? '—'}${sel.premium ? ' · premium' : ''}`);
        if (Array.isArray(sel.planCoders) && sel.planCoders.length) configLines.push(`    planCoders: ${sel.planCoders.join(', ')}`);
      }
    }
    if (configLines.length) lines.push('', '--- Agent Configuration ---', ...configLines);

    // Materials & Context + Code Changes (transaction) injected by the panel — put
    // them up top so a reviewer reads the goal and the actual diffs before the
    // raw telemetry that produced them.
    for (const section of extraSections) {
      if (section && section.trim()) lines.push('', section.trim());
    }

    if (errors.length) {
      lines.push('', `--- Errors (${errors.length}) ---`);
      for (const { ev, agentName } of errors) {
        lines.push(`[${ev.ts}] ${agentName} ${ev.toolName}${ev.category ? ` (${ev.category})` : ''} — ${cap(ev.result ?? ev.args ?? '')}`);
      }
    }

    lines.push('', `--- Telemetry events (${flatEvents.length}) ---`);
    for (const { ev, agentName } of flatEvents) {
      lines.push(`[${ev.ts}] ${agentName} ${ev.toolName}${ev.category ? ` (${ev.category})` : ''}${ev.durationMs != null ? ` · ${ev.durationMs}ms` : ''}`);
      if (ev.args) lines.push(`    args:   ${cap(ev.args)}`);
      if (ev.result) lines.push(`    result: ${cap(ev.result)}`);
    }

    lines.push('', `--- Logs (${mergedLogs.length}) ---`);
    for (const l of mergedLogs) lines.push(`[${l.ts}] ${l.level.toUpperCase().padEnd(5)} ${l.agentName} ${l.msg}`);

    return lines.join('\n');
  };

  // Thunk form: the report serialises every event, log line and (optionally) every
  // diff, so it is built on the click rather than on each render. A builder that
  // throws lands on `error`, exactly as the old try/catch around it did.
  const copyTriage = async () => {
    await triageCopy.copy(async () => {
      const extras: string[] = [];
      if (reportMaterials) extras.push(reportMaterials);
      if (reportTransaction) {
        try { const tx = await reportTransaction(); if (tx) extras.push(tx); }
        catch { /* a diff fetch failed — copy the rest rather than nothing */ }
      }
      return buildTriageReport(extras);
    });
  };

  // --------------------------------------------------------------------------
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 20, ...style }}>
      {/* Unified agent directory */}
      {!embedded && (
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t('agents')}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('agentsHint')}
          </span>
          {!scoped && unifiedAgents.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <button type="button" onClick={selectAll} style={smallBtn}>{t('selectAll')}</button>
              <button type="button" onClick={clearSelection} style={smallBtn}>{t('clear')}</button>
            </div>
          )}
        </div>

        {scoped ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('scopedFromPanel', { name: scopedAgent?.name ?? t('agentFallback') })}
          </div>
        ) : dirLoading ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loadingAgents')}</div>
        ) : unifiedAgents.length === 0 ? (
          <div style={emptyBox}>
            {dirError ? (
              <span>{dirError}</span>
            ) : (
              t.rich('noAgents', {
                link: (chunks) => (
                  <Link href="/workforce" style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>{chunks}</Link>
                ),
              })
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
                    borderRadius: 'var(--radius-md)',
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
                  {(a.kind === 'host' || a.kind === 'vscode') && (
                    <span
                      style={pillStyle(
                        a.online ? 'rgba(34,197,94,0.15)' : 'var(--bg-elevated)',
                        a.online ? 'rgba(34,197,94,0.95)' : 'var(--text-muted)'
                      )}
                    >
                      {a.online ? t('online') : t('offline')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Single view toggle — diagnostics as a log view or a timeline view */}
      {!embedded && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('viewLabel')}</span>
        <button type="button" onClick={() => setView('logs')} style={toggleBtn(view === 'logs')}>{t('logView')}</button>
        <button type="button" onClick={() => setView('timeline')} style={toggleBtn(view === 'timeline')}>{t('timelineView')}</button>
      </div>
      )}

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
                          ? 'var(--success, var(--success))'
                          : connState === 'offline'
                            ? 'var(--danger)'
                            : 'var(--text-muted)',
                    }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t(`conn.${connState}`)}</span>
                </>
              )}
              {hasCloudSelection && (
                <button type="button" onClick={() => void loadDiagnostics()} disabled={diagLoading} style={smallBtn}>
                  {diagLoading ? t('refreshing') : t('refreshCloud')}
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
                {t('autoScroll')}
              </label>
              <button type="button" onClick={() => setLogLines([])} style={smallBtn}>{t('clear')}</button>
              <button
                type="button"
                onClick={copyTriage}
                title={reportTransaction ? t('copyReportTitle') : t('copyTriageTitle')}
                style={triageCopy.state === 'error' ? { ...smallBtn, color: 'var(--danger)', borderColor: 'var(--danger)' } : smallBtn}
              >
                {triageCopy.state === 'copied'
                  ? `${tc('copied')} ✓`
                  : triageCopy.state === 'error'
                    ? tc('copyFailed')
                    : reportTransaction ? t('copyReport') : t('copyTriage')}
              </button>
            </div>
          )}
          {hasCloudSelection && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              {t('cloudNote')}
            </div>
          )}
          <div style={logPaneStyle}>
            {!hasSelection ? (
              <div style={{ color: 'var(--text-muted)' }}>
                {unifiedAgents.length === 0 && !dirLoading
                  ? t('registerThenSelect')
                  : t('selectForLogs')}
              </div>
            ) : filteredLogs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>{t('waitingForLogs')}</div>
            ) : (
              filteredLogs.map((l, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: 4,
                    color:
                      l.level === 'error'
                        ? 'var(--danger)'
                        : l.level === 'warn'
                          ? 'var(--warning, var(--warning))'
                          : 'var(--text-secondary)',
                  }}
                >
                  <span style={{ opacity: 0.5, marginRight: 8 }}>{l.ts.slice(11, 19)}</span>
                  <span
                    style={{
                      display: 'inline-block',
                      marginRight: 8,
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 10,
                      fontWeight: 600,
                      background: colorForKey(selectedKeys, l.agentKey),
                      color: 'var(--text-on-accent)',
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
          <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('timeline')}</div>
          {hasSelection ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder={t('categoryFilterPlaceholder')}
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{ ...selectStyle, width: 200 }}
                />
                <button type="button" onClick={() => void loadDiagnostics()} disabled={diagLoading} style={toggleBtn(true)}>
                  {diagLoading ? tc('loading') : t('refresh')}
                </button>
                <button type="button" onClick={() => setTimelineViewMode(timelineViewMode === 'list' ? 'gantt' : 'list')} style={smallBtn}>
                  {timelineViewMode === 'list' ? t('viewGantt') : t('viewList')}
                </button>
              </div>
              <div style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 24, minHeight: 240, maxHeight: 480, overflow: 'auto' }}>
                {diagError ? (
                  <div style={{ color: 'var(--danger)', fontSize: 13 }}>{diagError}</div>
                ) : diagLoading && tracks.length === 0 ? (
                  <div style={centerMuted}>{t('loadingTimeline')}</div>
                ) : tracks.length === 0 ? (
                  <div style={{ ...centerMuted, flexDirection: 'column', gap: 8 }}>
                    <div>{t('noTimelineEvents')}</div>
                    <div style={{ fontSize: 12 }}>{t('noTimelineHint')}</div>
                  </div>
                ) : timelineViewMode === 'list' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* `track`, not `t` — `t` is the translations function in this scope. */}
                    {tracks.map((track, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background:
                              track.status === 'failed'
                                ? 'var(--danger)'
                                : track.kind === 'tool'
                                  ? 'var(--accent)'
                                  : track.status === 'completed'
                                    ? 'var(--success, var(--success))'
                                    : track.status === 'running'
                                      ? 'var(--info)'
                                      : 'var(--text-muted)',
                            marginTop: 5,
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: colorForKey(selectedKeys, track.agentKey), color: 'var(--text-on-accent)', flexShrink: 0 }}>
                              {track.agentName}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{track.label}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {fmtTime(fmt, track.startMs)}
                            {track.endMs > track.startMs ? ` → ${fmtTime(fmt, track.endMs)} (${fmtDuration(track.endMs - track.startMs)})` : ''}
                          </div>
                          {track.detail && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{track.detail}</div>
                          )}
                        </div>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-deep)', color: 'var(--text-secondary)', flexShrink: 0 }}>
                          {track.status}
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
                  <span>{t('registerFirst')}</span>
                  <Link href="/workforce" style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>{t('goToWorkforce')}</Link>
                </>
              ) : (
                <span>{t('selectForTimeline')}</span>
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
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

const selectStyle: React.CSSProperties = {
  height: 28,
  padding: '3px 8px',
  fontSize: 12,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-deep)',
  color: 'var(--text-primary)',
};

const emptyBox: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-muted)',
  padding: 12,
  background: 'var(--bg-deep)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
};

const logPaneStyle: React.CSSProperties = {
  background: 'var(--bg-deep)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: 12,
  minHeight: 280,
  maxHeight: 480,
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
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
  };
}

