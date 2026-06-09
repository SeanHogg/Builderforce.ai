'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  runtimeApi,
  cloudAgents as cloudAgentsApi,
  isAwaitingApprovalExecution,
  type Task,
  type AgentHost,
  type Execution,
  type ExecutionTrace,
  type ExecutionTraceToolEvent,
  type TaskFileChange,
} from '@/lib/builderforceApi';
import { RunAgentControl } from '../task/RunAgentControl';
import { ChatMessageContent } from '../ChatMessageContent';
import { EXECUTION_STATUS_COLOR as STATUS_COLOR } from '../board/AgentChip';
import { ExecutionChip } from './ExecutionChip';
import { useExecutionStream, type ExecutionFileChange } from './useExecutionStream';
import { ObservabilityContent } from '../ObservabilityContent';
import { FileChangeViewer } from './FileChangeViewer';
import { PullRequestPanel } from './PullRequestPanel';

/**
 * Live execution view for a task. Queued runs stream their status, output
 * (rendered as markdown in a fixed-height scroll region), file changes, and tool
 * calls in real time; a chatbox lets the user steer a running agent mid-run.
 * Reused by both the project and task "Agent / Capabilities" surfaces.
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

const CHANGE_COLOR: Record<ExecutionFileChange['change'], string> = {
  created: 'var(--success, #16a34a)',
  modified: 'var(--coral-bright)',
  deleted: 'var(--danger, #dc2626)',
};

/**
 * One row in the Changes list. A button so it reads as clickable — selecting it
 * opens the file's diff in the Monaco viewer. Optional `agent` shows attribution
 * for the durable per-agent change rows.
 */
function ChangeRow({
  path,
  change,
  agent,
  onOpen,
}: {
  path: string;
  change: ExecutionFileChange['change'];
  agent?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="View this change in the editor"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
        padding: '6px 4px', borderTop: '1px solid var(--border-subtle)', border: 'none',
        borderTopColor: 'var(--border-subtle)', background: 'none', cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: CHANGE_COLOR[change], width: 64, flexShrink: 0 }}>{change}</span>
      <span style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--coral-bright)', wordBreak: 'break-all' }}>{path}</span>
      {agent && <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }} title="Agent that made this change">{agent}</span>}
    </button>
  );
}

type SubTab = 'output' | 'changes' | 'tools' | 'logs' | 'timeline' | 'pull-request';
const card: React.CSSProperties = { border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 14, marginBottom: 12 };
const RUNNING = new Set(['pending', 'submitted', 'running']);

export function AgentExecutionPanel({ task, agentHosts, onTaskChanged }: { task: Task; agentHosts: AgentHost[]; onTaskChanged?: () => void }) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [gate, setGate] = useState<{ approvalId: string; reason: string } | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('output');
  // File whose diff is open in the Changes tab's Monaco viewer (null = list view).
  const [openChange, setOpenChange] = useState<{ path: string; change: ExecutionFileChange['change'] } | null>(null);
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
  // the prior run, and its changes are a different file set than the new run's.
  useEffect(() => { setSentMessages([]); setOpenChange(null); }, [selectedId]);

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
  const thread = useMemo(() => {
    // Drop optimistic echoes the stream has since delivered (match by text).
    const echoed = new Set(stream.messages.filter((m) => m.role === 'user').map((m) => m.text));
    const optimistic = sentMessages
      .filter((t) => !echoed.has(t))
      .map((text) => ({ role: 'user' as const, text, ts: '' }));

    // Host runs stream turns live and in order — use them verbatim. Cloud runs
    // (no live assistant) rebuild assistant turns from persisted telemetry, then
    // close with the final summary if it isn't already the last narrated turn.
    if (hasLiveAssistant) return [...stream.messages, ...optimistic];
    const tail = historicalText && tracedAssistant.every((a) => a.text.trim() !== historicalText.trim())
      ? [{ role: 'assistant' as const, text: historicalText, ts: '' }]
      : [];
    const userTurns = stream.messages.filter((m) => m.role === 'user');
    return [...tracedAssistant, ...tail, ...userTurns, ...optimistic];
  }, [historicalText, hasLiveAssistant, tracedAssistant, stream.messages, sentMessages]);

  // Files: streamed changes win; fall back to result/tool-derived for past runs.
  const files = useMemo(() => {
    const map = new Map<string, ExecutionFileChange>();
    filesFromResult(result, toolEvents).forEach((f) => map.set(f.path, f));
    stream.fileChanges.forEach((f) => map.set(f.path, f));
    return [...map.values()];
  }, [result, toolEvents, stream.fileChanges]);

  const isRunning = status != null && RUNNING.has(status);

  // Scope the Logs/Timeline tabs to the agent that ACTUALLY executed the selected
  // run: a self-hosted host (execution.agentHostId) or, for cloud runs, the
  // ticket's assigned cloud agent (telemetry is keyed by its ide_agents.id, or
  // the '__default__' bucket when no named agent ran).
  const obsScopeProps = useMemo(() => {
    const hostId = (selected as { agentHostId?: number | null } | null)?.agentHostId;
    if (hostId != null) {
      return { agentHostId: hostId, agentHostName: agentHosts.find((h) => h.id === hostId)?.name ?? `Agent ${hostId}` };
    }
    const ref = task.assignedAgentRef ?? '__default__';
    const name = cloudAgentNames.get(ref) ?? (ref === '__default__' ? 'BuilderForce Cloud (default)' : 'Cloud agent');
    return { cloudAgentRef: ref, cloudAgentName: name };
  }, [selected, agentHosts, task.assignedAgentRef, cloudAgentNames]);

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
    // Render the direction immediately — we can't wait on the stream's echo,
    // which is unreliable cross-isolate. Rolled back below if the post fails.
    setSentMessages((prev) => [...prev, text]);
    setDraft('');
    try {
      await runtimeApi.postMessage(selectedId, text);
    } catch {
      // Roll back the optimistic echo and restore the draft for retry.
      setSentMessages((prev) => {
        const i = prev.lastIndexOf(text);
        if (i < 0) return prev;
        const next = [...prev];
        next.splice(i, 1);
        return next;
      });
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
      setRerunError(err instanceof Error ? err.message : 'Failed to re-run');
    } finally {
      setRerunningId(null);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      {/* Run control */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Run this task</div>
        <RunAgentControl
          task={task}
          agentHosts={agentHosts}
          onRan={() => { setGate(null); loadExecutions(true); onTaskChanged?.(); }}
          onAwaitingApproval={(g) => setGate({ approvalId: g.approvalId, reason: g.reason })}
        />
        {gate && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, padding: 10, background: 'var(--bg-deep)', borderRadius: 8 }}>
            Awaiting approval before this can run: {gate.reason}
          </div>
        )}
      </div>

      {/* Executions */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Executions</span>
        {taskCost && taskCost.requests > 0 && (
          <span
            style={{ fontSize: 12, color: 'var(--text-muted)' }}
            title={`Ticket spend across all runs: ${taskCost.totalTokens.toLocaleString()} tokens over ${taskCost.requests} LLM call(s). Rolls up to this project, then the account.`}
          >
            ~{taskCost.estimatedCostUsd < 0.01 ? '<$0.01' : `$${taskCost.estimatedCostUsd.toFixed(2)}`} spent on this ticket
          </span>
        )}
      </div>
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : executions.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No executions yet. Use Run above to queue this task to an agent.</div>
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Execution #{selected.id}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[status ?? ''] ?? 'var(--text-muted)' }}>{status}</span>
            {isRunning && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: stream.connected ? 'var(--success, #16a34a)' : 'var(--text-muted)' }} />
                {stream.connected ? 'live' : 'polling'}
              </span>
            )}
            <div style={{ flex: 1 }} />
            {isRunning && (
              <button type="button" onClick={cancel} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Cancel
              </button>
            )}
          </div>

          {errorMessage && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--danger, #dc2626)', marginBottom: 4 }}>Error</div>
              <div style={{ fontSize: 13, color: 'var(--danger, #dc2626)', whiteSpace: 'pre-wrap', lineHeight: 1.5, fontFamily: 'var(--font-mono)' }}>{errorMessage}</div>
            </div>
          )}

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 10 }}>
            {(() => { const changeCount = taskChanges.length || files.length; const base: Array<readonly [SubTab, string]> = [['output', 'Output'], ['changes', `Changes${changeCount ? ` (${changeCount})` : ''}`], ['tools', `Tools${toolEvents.length ? ` (${toolEvents.length})` : ''}`], ['logs', 'Logs'], ['timeline', 'Timeline']]; if (prUrl) base.push(['pull-request', 'Pull Request']); return base; })().map(([id, label]) => (
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
              <div
                ref={outputRef}
                style={{ height: 360, overflow: 'auto', padding: '4px 12px', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}
              >
                {thread.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>
                    {isRunning ? 'Agent is working… output will stream here.' : 'No output.'}
                  </div>
                ) : (
                  thread.map((m, i) => (
                    m.role === 'assistant' ? (
                      <div key={i} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)' }}>
                        <ChatMessageContent content={m.text} />
                      </div>
                    ) : (
                      <div key={i} style={{ margin: '8px 0', padding: '8px 12px', background: 'var(--surface-coral-soft)', borderRadius: 8, fontSize: 13, color: 'var(--text-primary)' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--coral-bright)', marginRight: 6 }}>You</span>
                        {m.text}
                      </div>
                    )
                  ))
                )}
              </div>

              {/* Chatbox — steer the running agent */}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
                  placeholder={isRunning ? 'Send the agent a new direction… (⌘/Ctrl+Enter)' : 'The agent is no longer running.'}
                  rows={2}
                  style={{ flex: 1, resize: 'vertical', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'inherit' }}
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={!draft.trim() || sending || selectedId == null}
                  style={{ alignSelf: 'flex-end', padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', background: !draft.trim() || sending ? 'var(--bg-elevated)' : 'var(--coral-bright)', color: !draft.trim() || sending ? 'var(--text-muted)' : '#fff', cursor: !draft.trim() || sending ? 'default' : 'pointer' }}
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>

              {/* This panel is a minimal per-execution view; the agent streams its
                  full logs / tool calls / timeline to Observability. */}
              {selected?.agentHostId != null && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  Minimal view — for full agent logs, tool calls, and timeline,{' '}
                  <Link href="/workforce?tab=logs" style={{ color: 'var(--coral-bright)' }}>
                    open Workforce → Logs →
                  </Link>
                </div>
              )}
            </>
          )}

          {subTab === 'changes' && (
            <div style={{ minHeight: 80 }}>
              {openChange ? (
                /* Detail: the selected file's diff in a read-only Monaco editor. */
                <div>
                  <button
                    type="button"
                    onClick={() => setOpenChange(null)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '4px 8px', fontSize: 12, border: 'none', background: 'none', color: 'var(--coral-bright)', cursor: 'pointer' }}
                  >
                    ‹ All changes
                  </button>
                  <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', wordBreak: 'break-all', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, textTransform: 'uppercase', color: CHANGE_COLOR[openChange.change], marginRight: 8 }}>{openChange.change}</span>
                    {openChange.path}
                  </div>
                  <FileChangeViewer taskId={task.id} path={openChange.path} />
                </div>
              ) : taskChanges.length > 0 ? (
                /* Durable, per-agent attributed changes from the ticket workspace. */
                taskChanges.map((f, i) => (
                  <ChangeRow
                    key={`${f.path}-${i}`}
                    path={f.path}
                    change={f.change}
                    agent={f.agent}
                    onOpen={() => setOpenChange({ path: f.path, change: f.change })}
                  />
                ))
              ) : files.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>
                  {isRunning ? 'No file changes yet.' : 'This run did not record any file changes.'}
                </div>
              ) : (
                files.map((f) => (
                  <ChangeRow
                    key={f.path}
                    path={f.path}
                    change={f.change}
                    onOpen={() => setOpenChange({ path: f.path, change: f.change })}
                  />
                ))
              )}
            </div>
          )}

          {subTab === 'tools' && (
            <div style={{ minHeight: 80 }}>
              {toolEvents.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>No tool calls recorded.</div>
              ) : (
                toolEvents.map((ev) => (
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
            <ObservabilityContent embedded initialView="logs" executionId={selectedId} {...obsScopeProps} />
          )}

          {subTab === 'timeline' && selectedId != null && (
            <ObservabilityContent embedded initialView="timeline" executionId={selectedId} {...obsScopeProps} />
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
