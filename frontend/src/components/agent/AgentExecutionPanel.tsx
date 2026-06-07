'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  runtimeApi,
  type Task,
  type AgentHost,
  type Execution,
  type ExecutionTrace,
  type ExecutionTraceToolEvent,
} from '@/lib/builderforceApi';
import { RunAgentControl } from '../task/RunAgentControl';
import { ChatMessageContent } from '../ChatMessageContent';
import { EXECUTION_STATUS_COLOR as STATUS_COLOR } from '../board/AgentChip';
import { useExecutionStream, type ExecutionFileChange } from './useExecutionStream';

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

const CHANGE_COLOR: Record<ExecutionFileChange['change'], string> = {
  created: 'var(--success, #16a34a)',
  modified: 'var(--coral-bright)',
  deleted: 'var(--danger, #dc2626)',
};

type SubTab = 'output' | 'changes' | 'tools';
const card: React.CSSProperties = { border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 14, marginBottom: 12 };
const RUNNING = new Set(['pending', 'submitted', 'running']);

export function AgentExecutionPanel({ task, agentHosts, onTaskChanged }: { task: Task; agentHosts: AgentHost[]; onTaskChanged?: () => void }) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [gate, setGate] = useState<{ approvalId: string; reason: string } | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('output');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

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
  const thread = useMemo(() => {
    const base = historicalText && !hasLiveAssistant ? [{ role: 'assistant' as const, text: historicalText, ts: '' }] : [];
    return [...base, ...stream.messages];
  }, [historicalText, hasLiveAssistant, stream.messages]);

  // Files: streamed changes win; fall back to result/tool-derived for past runs.
  const files = useMemo(() => {
    const map = new Map<string, ExecutionFileChange>();
    filesFromResult(result, toolEvents).forEach((f) => map.set(f.path, f));
    stream.fileChanges.forEach((f) => map.set(f.path, f));
    return [...map.values()];
  }, [result, toolEvents, stream.fileChanges]);

  const isRunning = status != null && RUNNING.has(status);

  // Auto-scroll output to the newest content as it streams.
  const outputRef = useRef<HTMLDivElement>(null);
  useEffect(() => { outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight }); }, [thread]);

  const send = async () => {
    const text = draft.trim();
    if (!text || selectedId == null || sending) return;
    setSending(true);
    try {
      await runtimeApi.postMessage(selectedId, text);
      setDraft('');
    } catch { /* surfaced via disabled state; keep the draft for retry */ }
    finally { setSending(false); }
  };

  const cancel = async () => {
    if (selectedId == null) return;
    try { await runtimeApi.cancel(selectedId); loadExecutions(); } catch { /* ignore */ }
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
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Executions</div>
      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
      ) : executions.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No executions yet. Use Run above to queue this task to an agent.</div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {executions.map((e) => {
            const st = (e.id === selectedId && stream.status) || e.status;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelectedId(e.id)}
                style={{
                  padding: '6px 10px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${selectedId === e.id ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                  background: selectedId === e.id ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
                  color: STATUS_COLOR[st] ?? 'var(--text-secondary)',
                }}
              >
                #{e.id} · {st}
              </button>
            );
          })}
        </div>
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
            {([['output', 'Output'], ['changes', `Changes${files.length ? ` (${files.length})` : ''}`], ['tools', `Tools${toolEvents.length ? ` (${toolEvents.length})` : ''}`]] as const).map(([id, label]) => (
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
            </>
          )}

          {subTab === 'changes' && (
            <div style={{ minHeight: 80 }}>
              {files.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>
                  {isRunning ? 'No file changes yet.' : 'This run did not record any file changes.'}
                </div>
              ) : (
                files.map((f) => (
                  <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: CHANGE_COLOR[f.change], width: 64, flexShrink: 0 }}>{f.change}</span>
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{f.path}</span>
                  </div>
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

          {prUrl && (
            <a href={prUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 12, fontSize: 13, color: 'var(--coral-bright)', fontFamily: 'var(--font-mono)' }}>
              View pull request →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
