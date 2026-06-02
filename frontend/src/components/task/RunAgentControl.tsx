'use client';

import { useEffect, useState } from 'react';
import {
  runtimeApi,
  llmApi,
  isAwaitingApprovalExecution,
  type Task,
  type Claw,
} from '@/lib/builderforceApi';

/**
 * Run-with-agent control — replaces the old "Send to Claw" button. A button
 * group: [ Agent ▾ | LLM model ▾ | Run ▶ ]. The user picks which connected
 * agent (claw) executes and which model it should use (default = the
 * builderforce.ai gateway default), then runs. The chosen model is forwarded
 * to the agent via the execution payload.
 *
 * Shared between the task Details tab (where Send to Claw used to be) and the
 * Agent tab header.
 */

const DEFAULT_MODEL_LABEL = 'builderforce.ai (default)';

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-deep)', color: 'var(--text-primary)', cursor: 'pointer',
};

export interface RunAgentControlProps {
  task: Task;
  claws: Claw[];
  /** Called after a successful submit (so the parent can refresh executions). */
  onRan?: (executionId: number) => void;
  /** Called when execution is gated behind an approval. */
  onAwaitingApproval?: (g: { approvalId: string; taskId: number; reason: string }) => void;
}

export function RunAgentControl({ task, claws, onRan, onAwaitingApproval }: RunAgentControlProps) {
  const [clawId, setClawId] = useState<string>(task.assignedClawId != null ? String(task.assignedClawId) : '');
  const [model, setModel] = useState<string>('');
  const [models, setModels] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    llmApi.models()
      .then((res) => {
        const list = 'data' in res ? res.data.map((m) => m.model) : res.models;
        setModels(list ?? []);
      })
      .catch(() => setModels([]));
  }, []);

  const run = async () => {
    setRunning(true); setError(null);
    try {
      const result = await runtimeApi.submitExecution({
        taskId: task.id,
        clawId: clawId ? Number(clawId) : undefined,
        // Forward the chosen model to the agent; default = gateway default.
        payload: model ? JSON.stringify({ model }) : undefined,
      });
      if (isAwaitingApprovalExecution(result)) {
        onAwaitingApproval?.({ approvalId: result.approvalId, taskId: result.taskId, reason: result.reason });
        return;
      }
      onRan?.(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'inline-flex', alignItems: 'stretch', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
        <select value={clawId} onChange={(e) => setClawId(e.target.value)} style={{ ...selectStyle, border: 'none', borderRight: '1px solid var(--border-subtle)' }} title="Agent">
          <option value="">Auto (any agent)</option>
          {claws.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.connectedAt ? '' : ' (offline)'}</option>
          ))}
        </select>
        <select value={model} onChange={(e) => setModel(e.target.value)} style={{ ...selectStyle, border: 'none', borderRight: '1px solid var(--border-subtle)' }} title="LLM model">
          <option value="">{DEFAULT_MODEL_LABEL}</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button
          type="button"
          onClick={run}
          disabled={running}
          style={{
            padding: '7px 16px', fontSize: 13, fontWeight: 600, border: 'none',
            background: 'var(--coral-bright)', color: '#fff', cursor: running ? 'default' : 'pointer',
            opacity: running ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {running ? 'Running…' : 'Run'}
          {!running && (
            <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: 'currentColor' }}><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 6 }}>{error}</div>}
    </div>
  );
}
