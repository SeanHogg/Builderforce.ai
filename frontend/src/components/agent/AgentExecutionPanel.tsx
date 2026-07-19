'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  runtimeApi,
  cloudAgents as cloudAgentsApi,
  taskSpecsApi,
  approvalsApi,
  kanbanApi,
  isAwaitingApprovalExecution,
  type Task,
  type AgentHost,
  type Approval,
  type Execution,
  type ExecutionTrace,
  type ExecutionTraceToolEvent,
  type TaskFileChange,
  type TaskRepoStatus,
} from '@/lib/builderforceApi';
import { unifiedDiff } from '@/lib/unifiedDiff';
import { RunAgentControl } from '../task/RunAgentControl';
import { ApprovalResolveControl } from '../humanRequests/ApprovalResolveControl';
import { ChatMessageBubble } from '../ChatMessageBubble';
import { EXECUTION_STATUS_COLOR as STATUS_COLOR } from '../board/AgentChip';
import { ExecutionChip } from './ExecutionChip';
import { EvermindRunChip } from './EvermindRunChip';
import { useExecutionStream, type ExecutionFileChange } from './useExecutionStream';
import { ObservabilityContent } from '../ObservabilityContent';
import { TaskChangesPanel } from './TaskChangesPanel';
import { PullRequestPanel } from './PullRequestPanel';

/**
 * Live execution view for a task. Queued runs stream their status, output
 * (rendered as markdown in a fixed-height scroll region), file changes, and tool
 * calls in real time. The Output chatbox steers a RUNNING agent mid-run, and on a
 * SETTLED run it starts a NEW run seeded with the message as its directive (the
 * directive is also recorded as a PRD revision server-side, so the spec evolves
 * with each run). Reused by both the project and task "Agent / Capabilities" surfaces.
 */

interface AgentResult {
  summary?: string;
  output?: string;
  files?: Array<{ path: string; status?: string }>;
  changedFiles?: string[];
}

function parseResult(raw: unknown): AgentResult | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try { return JSON.parse(raw) as AgentResult; } catch { return { output: raw }; }
}

/** File paths an agent touched, merged from the result blob and tool-call args. */
function filesFromResult(result: AgentResult | null, toolEvents: ExecutionTraceToolEvent[]): ExecutionFileChange[] {
  const map = new Map<string, ExecutionFileChange>();
  const add = (path: string, change: ExecutionFileChange['change']) => {
    if (path) map.set(path, { path, change, ts: '' });
  };
  result?.files?.forEach((f) => f.path && add(f.path, (f.status as ExecutionFileChange['change']) ?? 'modified'));
  result?.changedFiles?.forEach((p) => add(p, 'modified'));
  for (const ev of toolEvents) {
    if (!/write|create_file|edit|apply|patch|save|delete|remove|rm/i.test(ev.toolName)) continue;
    try {
      const args = ev.args ? JSON.parse(ev.args) as Record<string, unknown> : {};
      const path = (args.path ?? args.file ?? args.filename) as string | undefined;
      if (path) add(path, /delete|remove|rm/i.test(ev.toolName) ? 'deleted' : 'modified');
    } catch { /* ignore unparseable args */ }
  }
  return [...map.values()];
}

/**
 * Full assistant narration from an `agent.message` trace event. The complete text
 * is in `args.content` (the truncated `result` is the timeline preview), so prefer
 * it and fall back to `result` for older rows.
 */
function agentMessageText(ev: ExecutionTraceToolEvent): string {
  if (ev.args) {
    try {
      const a = JSON.parse(ev.args) as { content?: unknown };
      if (typeof a.content === 'string' && a.content.trim()) return a.content;
    } catch { /* fall through to result */ }
  }
  return (ev.result ?? '').trim();
}

/**
 * Run provenance for the triage report: how the run was dispatched and which LLM
 * model(s) ACTUALLY served its steps — read from telemetry, not from the task's
 * request. A "gateway-default" dispatch frequently falls through to a weak model
 * for every step; surfacing the served model (with a per-model step count) is what
 * lets a reviewer see that before trusting the output.
 */
function runProvenance(toolEvents: ExecutionTraceToolEvent[]): {
  dispatch?: { engine?: string; surface?: string; model?: string; executor?: string };
  models: string[];
  /** repo full-name as the run itself saw it (`context.prepare` telemetry) — a
   *  zero-fetch fallback when the authoritative repo-status call is unavailable. */
  repo?: string;
} {
  let dispatch: { engine?: string; surface?: string; model?: string; executor?: string } | undefined;
  let repo: string | undefined;
  const models = new Map<string, number>();
  for (const ev of toolEvents) {
    if (ev.toolName === 'runtime.dispatch' && ev.args && !dispatch) {
      try {
        const a = JSON.parse(ev.args) as Record<string, string>;
        dispatch = { engine: a.engine, surface: a.surface, model: a.model, executor: a.executor };
      } catch { /* ignore unparseable dispatch args */ }
    }
    if (ev.toolName === 'context.prepare' && ev.args && !repo) {
      try {
        const a = JSON.parse(ev.args) as { repo?: string };
        if (a.repo) repo = a.repo;
      } catch { /* ignore unparseable context args */ }
    }
    if (ev.toolName === 'llm.complete' && ev.args) {
      try {
        const a = JSON.parse(ev.args) as { model?: string };
        if (a.model) models.set(a.model, (models.get(a.model) ?? 0) + 1);
      } catch { /* ignore unparseable llm args */ }
    }
  }
  return { dispatch, models: [...models.entries()].map(([m, n]) => `${m} ×${n}`), repo };
}

type SubTab = 'output' | 'changes' | 'tools' | 'logs' | 'timeline' | 'pull-request';
const card: React.CSSProperties = { border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 14, marginBottom: 12 };
const RUNNING = new Set(['pending', 'submitted', 'running']);

/** The cloud agent that ran a specific execution — read from that execution's own
 *  persisted payload, so each run's logs/triage are scoped to the agent that
 *  ACTUALLY ran it (not the task's current `assignedAgentRef`, which later runs
 *  overwrite). Returns undefined for host runs / default runs with no pinned ref. */
function execCloudAgentRef(payload: unknown): string | undefined {
  if (typeof payload !== 'string' || !payload) return undefined;
  try {
    const p = JSON.parse(payload) as { cloudAgentRef?: unknown };
    return typeof p.cloudAgentRef === 'string' && p.cloudAgentRef.trim() ? p.cloudAgentRef.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Display name of the agent that ran a SPECIFIC execution — a self-hosted host,
 *  a named cloud agent, or the gateway-default bucket. Read from the execution's
 *  OWN fields (`agentHostId` / `cloudAgentRef`, stamped at dispatch), so it always
 *  reflects who actually ran THAT run — never the task's current assignment, which
 *  a later run overwrites. Shared by the execution header and the chip tooltips. */
function executionAgentName(
  e: { agentHostId?: number | null; cloudAgentRef?: string | null; payload?: unknown } | null | undefined,
  agentHosts: AgentHost[],
  cloudAgentNames: Map<string, string>,
): string {
  const hostId = e?.agentHostId;
  if (hostId != null) return agentHosts.find((h) => h.id === hostId)?.name ?? `Agent ${hostId}`;
  const ref = e?.cloudAgentRef ?? execCloudAgentRef(e?.payload);
  if (!ref) return 'BuilderForce Cloud (default)';
  return cloudAgentNames.get(ref) ?? 'Cloud agent';
}

/** The cloud-agent TYPE a run actually dispatched as (e.g. "Cloud Agent
 *  (Node/Container)"), read from the run's own `runtime.dispatch` telemetry — the
 *  authoritative per-run surface, independent of anything on the agent since. The
 *  type comes from what the run recorded, not from re-reading the agent's record. */
function runDispatchType(toolEvents: ExecutionTraceToolEvent[]): string | undefined {
  const ev = toolEvents.find((e) => e.toolName === 'runtime.dispatch');
  if (!ev?.args) return undefined;
  try {
    const d = JSON.parse(ev.args) as { agentType?: unknown };
    return typeof d.agentType === 'string' && d.agentType.trim() ? d.agentType.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Lifecycle/telemetry namespaces emitted into the trace stream that are NOT tool
 *  calls (narration, model completions, dispatch, planning, context prep). The
 *  Tools tab counts/lists only genuine tool invocations, so these are excluded. */
const NON_TOOL_NAMESPACES = new Set(['agent', 'llm', 'runtime', 'context', 'planning', 'capabilities']);
const NON_TOOL_CATEGORIES = new Set(['message', 'llm', 'planning', 'context', 'capabilities', 'lifecycle']);

/** True when a trace event is a real tool call (e.g. write_file, list_files), not
 *  a lifecycle/telemetry event (agent.message, llm.complete, context.prepare, …). */
function isGenuineToolCall(ev: ExecutionTraceToolEvent): boolean {
  if (ev.category && NON_TOOL_CATEGORIES.has(ev.category)) return false;
  const ns = ev.toolName.includes('.') ? ev.toolName.split('.')[0] : '';
  if (ns && NON_TOOL_NAMESPACES.has(ns)) return false;
  return true;
}

export function AgentExecutionPanel({ task, agentHosts, onTaskChanged }: { task: Task; agentHosts: AgentHost[]; onTaskChanged?: () => void }) {
  const t = useTranslations('agentExecution');
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [gate, setGate] = useState<{ approvalId: string; reason: string } | null>(null);
  // The full approval row behind the gate, fetched so a manager can resolve it
  // inline instead of bouncing to the Workforce approvals queue.
  const [gateApproval, setGateApproval] = useState<Approval | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('output');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Optimistic echoes of steering directions. The execution stream's subscriber
  // map is per-Worker-isolate, so the round-trip `message` event is usually
  // dropped and a sent direction would never render. We show it locally and drop
  // it once the stream echoes the same text back (see `thread`).
  const [sentMessages, setSentMessages] = useState<string[]>([]);
  // Durable per-agent file changes for the ticket's shared workspace (attributed).
  const [taskChanges, setTaskChanges] = useState<TaskFileChange[]>([]);
  // Re-run (retry/resume) of a terminal execution from its chip.
  const [rerunningId, setRerunningId] = useState<number | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  // Ticket-level spend (finest grain of the ticket → project → account rollup).
  const [taskCost, setTaskCost] = useState<{ estimatedCostUsd: number; totalTokens: number; requests: number } | null>(null);
  const [coordinated, setCoordinated] = useState(false);
  const [coordinating, setCoordinating] = useState(false);
  // Cloud-agent ref → display name, for scoping the Logs/Timeline tabs to the
  // agent that actually executed (cloud runs carry no host name).
  const [cloudAgentNames, setCloudAgentNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    cloudAgentsApi.list()
      .then((list) => setCloudAgentNames(new Map(list.map((a) => [a.ref, a.name]))))
      .catch(() => { /* directory unavailable — fall back to ref/defaults below */ });
  }, []);

  const loadExecutions = useCallback(async (selectLatest = false) => {
    setLoading(true);
    try {
      const list = await runtimeApi.listForTask(task.id);
      setExecutions(list);
      if ((selectLatest || selectedId == null) && list.length > 0) setSelectedId(list[0].id);
    } finally {
      setLoading(false);
    }
  }, [task.id, selectedId]);

  useEffect(() => { loadExecutions(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [task.id]);
  useEffect(() => {
    let live = true;
    kanbanApi.accountability(task.id)
      .then((report) => { if (live) setCoordinated(report.requiredCount > 0); })
      .catch(() => { if (live) setCoordinated(false); });
    return () => { live = false; };
  }, [task.id]);

  // Pull the gated approval so the inline resolve control can render. Cleared when
  // the gate clears (a run started or the gate was resolved/rejected).
  useEffect(() => {
    const approvalId = gate?.approvalId;
    if (!approvalId) { setGateApproval(null); return; }
    let alive = true;
    approvalsApi.get(approvalId)
      .then((a) => { if (alive) setGateApproval(a); })
      .catch(() => { if (alive) setGateApproval(null); });
    return () => { alive = false; };
  }, [gate?.approvalId]);

  // Ticket spend, refreshed when the run set changes (a new run adds cost). The
  // endpoint is cached server-side, so this is a cheap aggregate read.
  useEffect(() => {
    runtimeApi.taskCost(task.id).then(setTaskCost).catch(() => setTaskCost(null));
  }, [task.id, executions.length]);

  const loadTaskChanges = useCallback(() => {
    runtimeApi.taskFileChanges(task.id).then((r) => setTaskChanges(r.changes)).catch(() => { /* none yet */ });
  }, [task.id]);
  useEffect(() => { loadTaskChanges(); }, [loadTaskChanges]);

  // Switching runs resets per-execution view state: optimistic echoes belong to
  // the prior run. (The Changes panel resets its own open-file view via resetKey.)
  useEffect(() => { setSentMessages([]); }, [selectedId]);

  useEffect(() => {
    if (selectedId == null) { setTrace(null); return; }
    let cancelled = false;
    runtimeApi.trace(selectedId).then((t) => { if (!cancelled) setTrace(t); }).catch(() => { if (!cancelled) setTrace(null); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const stream = useExecutionStream(selectedId);

  // Live execution (from the stream) wins over the cached list row.
  const listSelected = executions.find((e) => e.id === selectedId) ?? null;
  const selected = (stream.execution && stream.execution.id === selectedId) ? stream.execution : listSelected;
  const status = (selectedId != null && stream.status) || selected?.status || null;

  const result = parseResult((selected as { result?: unknown } | null)?.result);
  const toolEvents = trace?.trace.toolEvents ?? [];
  // Genuine tool calls only — the Tools tab count + list exclude lifecycle/telemetry
  // events (agent.message, llm.complete, …) so "Tools (N)" reflects real invocations.
  const realToolEvents = toolEvents.filter(isGenuineToolCall);
  const errorMessage = (selected as { errorMessage?: string } | null)?.errorMessage;
  const prUrl = (selected as { githubPrUrl?: string } | null)?.githubPrUrl ?? task.githubPrUrl;

  // Output thread: historical result (if no live assistant text yet) + streamed turns.
  const historicalText = result?.summary ?? result?.output ?? '';
  const hasLiveAssistant = stream.messages.some((m) => m.role === 'assistant');
  // Cloud runs drop the live WS cross-isolate, so the agent's narration never
  // reaches stream.messages and Output is stuck on "Agent is working…" even while
  // Tools/Changes populate. It IS persisted as `agent.message` telemetry (re-polled
  // into `trace`), so rebuild the assistant turns from it as the fallback source.
  const tracedAssistant = useMemo(
    () => toolEvents
      .filter((ev) => ev.toolName === 'agent.message')
      .map((ev) => ({ role: 'assistant' as const, text: agentMessageText(ev), ts: ev.ts }))
      .filter((m) => m.text)
      .sort((a, b) => a.ts.localeCompare(b.ts)), // endpoint returns newest-first
    [toolEvents],
  );
  // Durable steering/chat thread (persisted server-side). The source of truth for
  // user steers across a reload — the WS echo is cross-isolate-lossy, so without
  // this a sent direction vanished on refresh.
  const persistedMessages = trace?.trace.messages ?? [];
  const thread = useMemo(() => {
    const persistedUserTexts = new Set(persistedMessages.filter((m) => m.role === 'user').map((m) => m.text));
    const streamUserTexts = new Set(stream.messages.filter((m) => m.role === 'user').map((m) => m.text));
    // Optimistic echoes the stream/persistence haven't reflected yet (match by text).
    const optimistic = sentMessages
      .filter((t) => !streamUserTexts.has(t) && !persistedUserTexts.has(t))
      .map((text) => ({ role: 'user' as const, text, ts: '' }));

    if (hasLiveAssistant) {
      // Host runs stream turns live and in order — use them verbatim, plus any
      // persisted user steer the live stream didn't carry (cross-isolate gap).
      const streamTexts = new Set(stream.messages.map((m) => m.text));
      const persistedExtra = persistedMessages.filter((m) => m.role === 'user' && !streamTexts.has(m.text));
      return [...stream.messages, ...persistedExtra, ...optimistic];
    }
    // Cloud runs (no live assistant): rebuild assistant turns from telemetry and
    // interleave the persisted user steers by timestamp, then close with the final
    // summary if it isn't already the last narrated turn.
    const persistedUser = persistedMessages.filter((m) => m.role === 'user');
    const merged = [...tracedAssistant, ...persistedUser].sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
    const tail = historicalText && tracedAssistant.every((a) => a.text.trim() !== historicalText.trim())
      ? [{ role: 'assistant' as const, text: historicalText, ts: '' }]
      : [];
    return [...merged, ...tail, ...optimistic];
  }, [persistedMessages, historicalText, hasLiveAssistant, tracedAssistant, stream.messages, sentMessages]);

  // Files: streamed changes win; fall back to result/tool-derived for past runs.
  const files = useMemo(() => {
    const map = new Map<string, ExecutionFileChange>();
    filesFromResult(result, toolEvents).forEach((f) => map.set(f.path, f));
    stream.fileChanges.forEach((f) => map.set(f.path, f));
    return [...map.values()];
  }, [result, toolEvents, stream.fileChanges]);

  const isRunning = status != null && RUNNING.has(status);

  // PRD (materials) for this task — fed into the copy-triage report so a shared
  // log carries the GOAL, not just telemetry.
  const [prd, setPrd] = useState<string | null>(null);
  useEffect(() => {
    taskSpecsApi.list(task.id)
      .then((specs) => {
        const s = specs.find((x) => x.isPrimary && x.prd) ?? specs.find((x) => x.prd) ?? null;
        setPrd(s?.prd ?? null);
      })
      .catch(() => setPrd(null));
  }, [task.id]);

  // Repo binding for this task — the authoritative repo / base branch and whether
  // commits can actually land (bound + credentialed). Fed into the review context
  // so a reviewer knows where the code lives and, when no PR exists, whether that's
  // because the repo was never wired vs. the agent simply produced nothing. One
  // fetch per task (deduped by task.id), mirroring the PRD fetch above.
  const [repoStatus, setRepoStatus] = useState<TaskRepoStatus | null>(null);
  useEffect(() => {
    runtimeApi.taskRepoStatus(task.id)
      .then(setRepoStatus)
      .catch(() => setRepoStatus(null));
  }, [task.id]);

  // "Materials & Context" section for the copy-triage report: the task + its PRD.
  const reportMaterials = useMemo(() => {
    const lines = ['--- Materials & Context ---', `Task #${task.id}: ${task.title}`];
    if (task.description?.trim()) lines.push('', 'Description:', task.description.trim());
    if (prd?.trim()) lines.push('', 'PRD:', prd.trim());
    return lines.join('\n');
  }, [task.id, task.title, task.description, prd]);

  // "Review Context" section — the run's provenance and where to find the code it
  // produced, so the report is independently REVIEWABLE: the PR URL to open, the
  // branch, the outcome (+ failure reason), and the model(s) that REALLY ran each
  // step (often weaker than the requested model). Leads the report so a reviewer
  // can pull up the PR/diff before wading into raw telemetry.
  const reviewContext = useMemo(() => {
    const { dispatch, models, repo } = runProvenance(toolEvents);
    const lines = ['--- Review Context ---'];
    lines.push(`Outcome: ${status ?? 'unknown'}${errorMessage ? ` — ${errorMessage}` : ''}`);
    lines.push(
      prUrl
        ? `Pull request: ${prUrl}${task.githubPrNumber ? ` (#${task.githubPrNumber})` : ''}`
        : 'Pull request: none — no PR was opened for this run (nothing to review on GitHub)'
    );
    const repoName = repoStatus?.repo ?? repo;
    if (repoName) lines.push(`Repo: ${repoName}`);
    const head = task.gitBranch;
    const base = repoStatus?.base;
    if (head || base) lines.push(`Branch: ${head ?? '(default)'}${base ? ` → ${base}` : ''}`);
    // When no PR exists, the binding state is the reviewer's first question: was the
    // repo even wired? An unbound / uncredentialed task can't commit, so "no PR" is
    // expected — distinct from the agent running and producing nothing.
    if (repoStatus && (!repoStatus.bound || !repoStatus.hasCredential)) {
      const why = !repoStatus.bound ? 'no repo bound' : 'no write credential';
      lines.push(`Repo binding: NOT WRITABLE — ${repoStatus.reason ?? why} (commits/PR cannot be produced)`);
    }
    if (dispatch) {
      const d = [dispatch.engine, dispatch.surface && `surface=${dispatch.surface}`, dispatch.executor && `executor=${dispatch.executor}`]
        .filter(Boolean).join(' · ');
      lines.push(`Dispatch: ${d || '—'}${dispatch.model ? ` · requested model=${dispatch.model}` : ''}`);
    }
    lines.push(`Model(s) actually run: ${models.length ? models.join(', ') : 'none recorded'}`);
    const summary = historicalText.trim();
    if (summary) lines.push('', 'Agent final summary:', summary.length > 1500 ? summary.slice(0, 1500) + '…' : summary);
    return lines.join('\n');
  }, [toolEvents, status, errorMessage, prUrl, task.githubPrNumber, task.gitBranch, historicalText, repoStatus]);

  // The report's leading prose: review context first (where/how to review), then
  // materials (the goal). Joined here once so both Observability surfaces below
  // pass the same preamble. Telemetry + diffs follow inside the report builder.
  const reportPreamble = useMemo(
    () => [reviewContext, reportMaterials].join('\n\n'),
    [reviewContext, reportMaterials],
  );

  // "Code Changes (transaction)" section: the actual diffs THIS run produced, so a
  // shared log is reviewable as a patch. Fetched lazily (only when the user copies)
  // so the panel stays light — each file's base/current comes from the same API the
  // Monaco diff viewer uses.
  const buildTransaction = useCallback(async (): Promise<string> => {
    const scoped = taskChanges.filter((c) => c.executionId === selectedId);
    const list: Array<{ path: string; change: ExecutionFileChange['change'] }> =
      scoped.length > 0
        ? scoped.map((c) => ({ path: c.path, change: c.change }))
        : files.map((f) => ({ path: f.path, change: f.change }));
    if (list.length === 0) return '';
    const diffs = await Promise.all(list.map(async (f) => {
      try {
        const content = await runtimeApi.taskFileContent(task.id, f.path);
        if (!content.bound) return `### ${f.change.toUpperCase()} ${f.path}\n(no repo bound — content unavailable)`;
        return unifiedDiff(f.path, f.change, content.base, content.current);
      } catch {
        return `### ${f.path}\n(failed to load diff)`;
      }
    }));
    return `--- Code Changes (transaction · ${list.length} file${list.length === 1 ? '' : 's'}) ---\n\n${diffs.join('\n\n')}`;
  }, [taskChanges, files, selectedId, task.id]);

  // Scope the Logs/Timeline tabs to the agent that ACTUALLY executed the selected
  // run: a self-hosted host (execution.agentHostId) or, for cloud runs, the
  // ticket's assigned cloud agent (telemetry is keyed by its ide_agents.id, or
  // the '__default__' bucket when no named agent ran).
  const obsScopeProps = useMemo(() => {
    const hostId = (selected as { agentHostId?: number | null } | null)?.agentHostId;
    if (hostId != null) {
      return { agentHostId: hostId, agentHostName: agentHosts.find((h) => h.id === hostId)?.name ?? `Agent ${hostId}` };
    }
    // Scope to the agent that ran THE SELECTED execution: its persisted
    // `cloudAgentRef` (stamped at dispatch), else its payload, else the task's
    // current agent for legacy runs. Using task.assignedAgentRef alone was the
    // "logs don't update" bug: a later run reassigns the task, so viewing an older
    // execution showed the new agent's telemetry (or empty) instead of what ran.
    const ref = (selected as { cloudAgentRef?: string | null } | null)?.cloudAgentRef
      ?? execCloudAgentRef(selected?.payload)
      ?? task.assignedAgentRef ?? '__default__';
    const name = cloudAgentNames.get(ref) ?? (ref === '__default__' ? 'BuilderForce Cloud (default)' : 'Cloud agent');
    return { cloudAgentRef: ref, cloudAgentName: name };
  }, [selected, agentHosts, task.assignedAgentRef, cloudAgentNames]);

  // Per-run agent identity for the selected execution's header: the name of the
  // agent that ACTUALLY ran it (from its own stamped fields) plus the authoritative
  // engine type it dispatched as (from its own telemetry). Both are scoped to the
  // run, so reopening an older execution shows what ran it — not the task's current
  // (possibly since-changed V1↔V2) assignment.
  const runAgentName = useMemo(
    () => (selected ? executionAgentName(selected, agentHosts, cloudAgentNames) : ''),
    [selected, agentHosts, cloudAgentNames],
  );
  const runAgentType = useMemo(() => runDispatchType(toolEvents), [toolEvents]);
  const evermindModels = useMemo(() => runProvenance(toolEvents).models, [toolEvents]);

  // Auto-scroll output to the newest content as it streams.
  const outputRef = useRef<HTMLDivElement>(null);
  useEffect(() => { outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight }); }, [thread]);

  // While a run is in-flight, re-poll the trace so tool calls + file changes
  // appear live (the relay persists tool-audit events as they happen). The WS
  // gives instant status; this gives live Changes/Tools without cross-isolate
  // event plumbing. Bounded: only polls while running, stops on terminal.
  useEffect(() => {
    if (selectedId == null || !isRunning) {
      // Run settled (or none selected) — pick up changes persisted as it ended.
      if (selectedId != null && !isRunning) loadTaskChanges();
      return;
    }
    const t = setInterval(() => {
      runtimeApi.trace(selectedId).then((tr) => setTrace(tr)).catch(() => { /* transient */ });
      loadTaskChanges();
    }, 4000);
    return () => clearInterval(t);
  }, [selectedId, isRunning, loadTaskChanges]);

  const send = async () => {
    const text = draft.trim();
    if (!text || selectedId == null || sending) return;
    setSending(true);
    setDraft('');
    // Steering a LIVE run: render the direction immediately — we can't wait on the
    // stream's echo, which is unreliable cross-isolate. (A follow-up to a terminal
    // run spawns a NEW run, so we don't echo onto the old one — we switch to the new
    // execution once it's created.) Rolled back below if the post fails.
    if (isRunning) setSentMessages((prev) => [...prev, text]);
    try {
      const res = await runtimeApi.postMessage(selectedId, text);
      if (res.rerun?.executionId) {
        // Terminal run → a new run was started with this directive. Follow it.
        await loadExecutions(true);
        setSelectedId(res.rerun.executionId);
        onTaskChanged?.();
      }
    } catch {
      // Roll back the optimistic echo (if any) and restore the draft for retry.
      if (isRunning) {
        setSentMessages((prev) => {
          const i = prev.lastIndexOf(text);
          if (i < 0) return prev;
          const next = [...prev];
          next.splice(i, 1);
          return next;
        });
      }
      setDraft(text);
    } finally { setSending(false); }
  };

  const cancel = async () => {
    if (selectedId == null) return;
    try { await runtimeApi.cancel(selectedId); loadExecutions(); } catch { /* ignore */ }
  };

  // Re-run a terminal execution (failed/cancelled) — or resume a paused one — by
  // re-submitting the task with the original run's target + payload (its model +
  // cloud-agent ref), so the retry runs as the same agent rather than the default.
  const rerun = async (e: Execution) => {
    if (rerunningId != null) return;
    setRerunningId(e.id);
    setRerunError(null);
    try {
      const result = await runtimeApi.submitExecution({
        taskId: task.id,
        agentHostId: e.agentHostId ?? undefined,
        payload: typeof e.payload === 'string' ? e.payload : undefined,
      });
      if (isAwaitingApprovalExecution(result)) {
        setGate({ approvalId: result.approvalId, reason: result.reason });
        return;
      }
      setGate(null);
      loadExecutions(true);
      onTaskChanged?.();
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : t('failedToRerun'));
    } finally {
      setRerunningId(null);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      {/* Run control */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{coordinated ? t('coordinateThisTicket') : t('runThisTask')}</div>
        {coordinated ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={coordinating}
              onClick={() => {
                setCoordinating(true);
                kanbanApi.coordinate(task.id)
                  .then(() => { loadExecutions(true); onTaskChanged?.(); })
                  .finally(() => setCoordinating(false));
              }}
              style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: 'var(--coral-bright)', color: '#fff', fontWeight: 600, cursor: coordinating ? 'default' : 'pointer', opacity: coordinating ? 0.65 : 1 }}
            >
              {coordinating ? t('coordinating') : t('coordinateNow')}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: '1 1 260px' }}>{t('coordinateHint')}</span>
          </div>
        ) : (
          <RunAgentControl
            task={task}
            agentHosts={agentHosts}
            onRan={() => { setGate(null); loadExecutions(true); onTaskChanged?.(); }}
            onAwaitingApproval={(g) => setGate({ approvalId: g.approvalId, reason: g.reason })}
          />
        )}
        {gate && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, padding: 10, background: 'var(--bg-deep)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span>{t('awaitingApproval', { reason: gate.reason })}</span>
            {/* Resolve inline — approving auto-starts the run (server replays it as
                the same agent + model) and we follow the new execution. */}
            {gateApproval && (
              <ApprovalResolveControl
                approval={gateApproval}
                compact
                onResolved={(updated) => {
                  setGate(null);
                  setGateApproval(null);
                  if (updated.status === 'approved') {
                    if (updated.startedExecutionId != null) setSelectedId(updated.startedExecutionId);
                    loadExecutions(true);
                    onTaskChanged?.();
                  }
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Executions */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t('executions')}</span>
        {taskCost && taskCost.requests > 0 && (
          <span
            style={{ fontSize: 12, color: 'var(--text-muted)' }}
            title={t('ticketSpendTooltip', { tokens: taskCost.totalTokens.toLocaleString(), requests: taskCost.requests })}
          >
            {t('spentOnTicket', { amount: taskCost.estimatedCostUsd < 0.01 ? '<$0.01' : `$${taskCost.estimatedCostUsd.toFixed(2)}` })}
          </span>
        )}
      </div>
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : executions.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noExecutions')}</div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: rerunError ? 6 : 12 }}>
          {executions.map((e) => {
            const st = (e.id === selectedId && stream.status) || e.status;
            return (
              <ExecutionChip
                key={e.id}
                id={e.id}
                status={st}
                selected={selectedId === e.id}
                onSelect={() => setSelectedId(e.id)}
                onRerun={() => rerun(e)}
                rerunning={rerunningId === e.id}
                agentName={executionAgentName(e, agentHosts, cloudAgentNames)}
              />
            );
          })}
        </div>
      )}
      {rerunError && (
        <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginBottom: 12 }}>{rerunError}</div>
      )}

      {/* Selected execution */}
      {selected && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{t('executionHeader', { id: selected.id })}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[status ?? ''] ?? 'var(--text-muted)' }}>{status}</span>
            {runAgentName && (
              <span
                title={t('agentThatRan')}
                style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 6, background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)' }}
              >
                {runAgentName}
                {runAgentType && !runAgentName.includes(runAgentType) && (
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('ranAs', { type: runAgentType })}</span>
                )}
              </span>
            )}
            <EvermindRunChip models={evermindModels} projectId={task.projectId} />
            {isRunning && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: stream.connected ? 'var(--success, #16a34a)' : 'var(--text-muted)' }} />
                {stream.connected ? t('live') : t('polling')}
              </span>
            )}
            <div style={{ flex: 1 }} />
            {isRunning && (
              <button type="button" onClick={cancel} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                {t('cancel')}
              </button>
            )}
          </div>

          {errorMessage && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--danger, #dc2626)', marginBottom: 4 }}>{t('error')}</div>
              <div style={{ fontSize: 13, color: 'var(--danger, #dc2626)', whiteSpace: 'pre-wrap', lineHeight: 1.5, fontFamily: 'var(--font-mono)' }}>{errorMessage}</div>
            </div>
          )}

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 10 }}>
            {(() => { const changeCount = taskChanges.length || files.length; const base: Array<readonly [SubTab, string]> = [['output', t('tabOutput')], ['changes', `${t('tabChanges')}${changeCount ? ` (${changeCount})` : ''}`], ['tools', `${t('tabTools')}${realToolEvents.length ? ` (${realToolEvents.length})` : ''}`], ['logs', t('tabLogs')], ['timeline', t('tabTimeline')]]; if (prUrl) base.push(['pull-request', t('tabPullRequest')]); return base; })().map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSubTab(id)}
                style={{
                  padding: '6px 12px', fontSize: 12, border: 'none', background: 'none', cursor: 'pointer',
                  borderBottom: `2px solid ${subTab === id ? 'var(--coral-bright)' : 'transparent'}`,
                  color: subTab === id ? 'var(--coral-bright)' : 'var(--text-muted)', fontWeight: subTab === id ? 600 : 400,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {subTab === 'output' && (
            <>
              {/* Brain-style conversation: each turn is labeled with WHO is talking
                  — the agent that ran this execution vs. the user's steers — and the
                  user's directions interleave between the agent's narration. */}
              <div
                ref={outputRef}
                style={{ height: 360, overflow: 'auto', padding: 12, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                {thread.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>
                    {isRunning ? t('agentWorking') : t('noOutput')}
                  </div>
                ) : (
                  thread.map((m, i) => (
                    <ChatMessageBubble
                      key={i}
                      role={m.role}
                      content={m.text}
                      label={m.role === 'assistant' ? (runAgentName || t('agent')) : t('you')}
                      avatar={m.role === 'assistant' ? (runAgentName ? runAgentName.charAt(0).toUpperCase() : '🤖') : undefined}
                    />
                  ))
                )}
              </div>

              {/* Chatbox — steer the running agent */}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
                  placeholder={isRunning ? t('steerPlaceholder') : t('followUpPlaceholder')}
                  rows={2}
                  style={{ flex: 1, resize: 'vertical', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'inherit' }}
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!draft.trim() || sending || selectedId == null}
                  style={{ alignSelf: 'flex-end', padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', background: !draft.trim() || sending ? 'var(--bg-elevated)' : 'var(--coral-bright)', color: !draft.trim() || sending ? 'var(--text-muted)' : '#fff', cursor: !draft.trim() || sending ? 'default' : 'pointer' }}
                  title={isRunning ? t('steerTitle') : t('startRunTitle')}
                >
                  {sending ? (isRunning ? t('sendingLabel') : t('startingLabel')) : isRunning ? t('send') : t('startRun')}
                </button>
              </div>

              {/* This panel is a minimal per-execution view; the agent streams its
                  full logs / tool calls / timeline to Observability. */}
              {selected?.agentHostId != null && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  {t('minimalView')}{' '}
                  <Link href="/workforce?tab=logs" style={{ color: 'var(--coral-bright)' }}>
                    {t('openWorkforceLogs')}
                  </Link>
                </div>
              )}
            </>
          )}

          {subTab === 'changes' && (
            // Durable per-agent attributed changes from the ticket workspace, else
            // the live execution file set. The shared panel owns the list + Monaco
            // diff detail (same component as the first-class task Changes tab).
            <TaskChangesPanel
              taskId={task.id}
              resetKey={selectedId ?? undefined}
              changes={
                taskChanges.length > 0
                  ? taskChanges
                      .filter((f) => selectedId == null || f.executionId === selectedId)
                      .map((f) => ({ path: f.path, change: f.change, agent: f.agent, executionId: f.executionId, createdAt: f.createdAt, models: f.models, modelUsage: f.modelUsage }))
                  : files.map((f) => ({ path: f.path, change: f.change }))
              }
              emptyLabel={isRunning ? t('noFileChangesYet') : t('noFileChangesRecorded')}
            />
          )}

          {subTab === 'tools' && (
            <div style={{ minHeight: 80, maxHeight: 360, overflow: 'auto' }}>
              {realToolEvents.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>{t('noToolCalls')}</div>
              ) : (
                realToolEvents.map((ev) => (
                  <div key={ev.id} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '3px 0', borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--coral-bright)' }}>{ev.toolName}</span>
                    {ev.durationMs != null && <span style={{ color: 'var(--text-muted)' }}> · {ev.durationMs}ms</span>}
                    {ev.args && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{ev.args.slice(0, 240)}</div>}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Logs + Timeline reuse the Observability views, scoped to the agent
              that executed this run (host or cloud). Same component the
              Observability page renders, so there's one source of truth. */}
          {subTab === 'logs' && selectedId != null && (
            <ObservabilityContent embedded initialView="logs" executionId={selectedId} {...obsScopeProps}
              reportMaterials={reportPreamble} reportTransaction={buildTransaction} />
          )}

          {subTab === 'timeline' && selectedId != null && (
            <ObservabilityContent embedded initialView="timeline" executionId={selectedId} {...obsScopeProps}
              reportMaterials={reportPreamble} reportTransaction={buildTransaction} />
          )}

          {/* In-product PR review + Approve & Merge (replaces the old external
              "View pull request" link). Owns its own visibility, so mounting it
              when the task has a PR is enough. */}
          {subTab === 'pull-request' && (
            <PullRequestPanel taskId={task.id} onMerged={() => onTaskChanged?.()} />
          )}
        </div>
      )}
    </div>
  );
}
