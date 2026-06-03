'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  runtimeApi,
  type Task,
  type AgentHost,
  type Execution,
  type ExecutionTrace,
  type ExecutionTraceToolEvent,
} from '@/lib/builderforceApi';
import { RunAgentControl } from './RunAgentControl';
import { AgentHostChatContent } from '../AgentHostChatContent';
import { EXECUTION_STATUS_COLOR as STATUS_COLOR } from '../board/AgentChip';

/**
 * "Agent" tab of the task details panel. Shows the run control, the task's
 * execution history, the selected execution's status + output + tool calls +
 * files the agent created/modified, and (when an agent is assigned) a chat so
 * the user can watch tool calls and direct the agent with new messages.
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

/** Best-effort: surface file paths an agent touched, from result + tool calls. */
function filesFromExecution(result: AgentResult | null, toolEvents: ExecutionTraceToolEvent[]): string[] {
  const set = new Set<string>();
  result?.files?.forEach((f) => f.path && set.add(f.path));
  result?.changedFiles?.forEach((p) => set.add(p));
  for (const ev of toolEvents) {
    if (!/write|create_file|edit|apply|patch|save/i.test(ev.toolName)) continue;
    try {
      const args = ev.args ? JSON.parse(ev.args) as Record<string, unknown> : {};
      const path = (args.path ?? args.file ?? args.filename) as string | undefined;
      if (path) set.add(path);
    } catch { /* ignore unparseable args */ }
  }
  return [...set];
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 14, marginBottom: 12,
};

export function TaskAgentTab({ task, agentHosts, onTaskChanged }: { task: Task; agentHosts: AgentHost[]; onTaskChanged?: () => void }) {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [gate, setGate] = useState<{ approvalId: string; reason: string } | null>(null);

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

  const selected = executions.find((e) => e.id === selectedId) ?? null;
  const result = parseResult((selected as { result?: unknown } | null)?.result);
  const toolEvents = trace?.trace.toolEvents ?? [];
  const files = filesFromExecution(result, toolEvents);
  const prUrl = (selected as { githubPrUrl?: string } | null)?.githubPrUrl ?? task.githubPrUrl;

  const assignedAgentHost = agentHosts.find((c) => c.id === task.assignedAgentHostId) ?? null;

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
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No executions yet. Use Run above to dispatch this task to an agent.</div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {executions.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelectedId(e.id)}
              style={{
                padding: '6px 10px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${selectedId === e.id ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                background: selectedId === e.id ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
                color: STATUS_COLOR[e.status] ?? 'var(--text-secondary)',
              }}
            >
              #{e.id} · {e.status}
            </button>
          ))}
        </div>
      )}

      {/* Selected execution detail */}
      {selected && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Execution #{selected.id}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[selected.status] ?? 'var(--text-muted)' }}>{selected.status}</span>
          </div>

          {(result?.summary || result?.output) && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Output</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {result?.summary ?? result?.output}
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Files created / modified</div>
              {files.map((f) => (
                <div key={f} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', padding: '2px 0' }}>{f}</div>
              ))}
            </div>
          )}

          {toolEvents.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Tool calls</div>
              {toolEvents.map((ev) => (
                <div key={ev.id} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '3px 0', borderTop: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--coral-bright)' }}>{ev.toolName}</span>
                  {ev.durationMs != null && <span style={{ color: 'var(--text-muted)' }}> · {ev.durationMs}ms</span>}
                  {ev.args && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{ev.args.slice(0, 240)}</div>}
                </div>
              ))}
            </div>
          )}

          {prUrl && (
            <a href={prUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--coral-bright)', fontFamily: 'var(--font-mono)' }}>
              View pull request →
            </a>
          )}
        </div>
      )}

      {/* Agent chat — watch tool calls & direct the agent */}
      <div style={{ fontWeight: 600, fontSize: 14, margin: '16px 0 8px' }}>Agent chat</div>
      {assignedAgentHost ? (
        <div style={{ height: 380, border: '1px solid var(--border-subtle)', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <AgentHostChatContent agentHostId={assignedAgentHost.id} agentHostName={assignedAgentHost.name} />
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Assign a connected agent to this task (Edit → assignee) to chat with it and direct its work.
        </div>
      )}
    </div>
  );
}
