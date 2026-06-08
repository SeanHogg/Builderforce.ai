'use client';

import { Select } from '@/components/Select';

import { useEffect, useState } from 'react';
import {
  runtimeApi,
  llmApi,
  isAwaitingApprovalExecution,
  type Task,
  type AgentHost,
} from '@/lib/builderforceApi';
import { loadAgentPool, type PoolAgent } from '@/lib/agentPool';

/**
 * Run-with-agent control — replaces the old "Send to AgentHost" button. A button
 * group: [ Agent ▾ | LLM model ▾ | Run ▶ ]. The user picks which connected
 * agent (agentHost) executes and which model it should use (default = the
 * builderforce.ai gateway default), then runs. The chosen model is forwarded
 * to the agent via the execution payload.
 *
 * Shared between the task Details tab (where Send to AgentHost used to be) and the
 * Agent tab header.
 */

const DEFAULT_MODEL_LABEL = 'builderforce.ai (default)';

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-deep)', color: 'var(--text-primary)', cursor: 'pointer',
};

export interface RunAgentControlProps {
  task: Task;
  agentHosts: AgentHost[];
  /** Called after a successful submit (so the parent can refresh executions). */
  onRan?: (executionId: number) => void;
  /** Called when execution is gated behind an approval. */
  onAwaitingApproval?: (g: { approvalId: string; taskId: number; reason: string }) => void;
}

export function RunAgentControl({ task, agentHosts, onRan, onAwaitingApproval }: RunAgentControlProps) {
  // target encodes the run target: '' = auto, 'host:<id>' = a self-hosted
  // executor, 'cloud:<ref>' = run AS a cloud agent (its model via an executor).
  // Default to the ticket's assigned agent so the control reflects who actually
  // runs it: a cloud agent (the swimlane's agent) wins, else a self-hosted host.
  const [target, setTarget] = useState<string>(
    task.assignedAgentRef ? `cloud:${task.assignedAgentRef}` : task.assignedAgentHostId != null ? `host:${task.assignedAgentHostId}` : '',
  );
  const [model, setModel] = useState<string>('');
  const [models, setModels] = useState<string[]>([]);
  const [cloudAgents, setCloudAgents] = useState<PoolAgent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    llmApi.models()
      .then((res) => {
        const list = 'data' in res ? res.data.map((m) => m.model) : res.models;
        setModels(list ?? []);
      })
      .catch(() => setModels([]));
    loadAgentPool().then((p) => setCloudAgents(p.filter((a) => a.kind === 'workforce'))).catch(() => setCloudAgents([]));
  }, []);

  const run = async () => {
    setRunning(true); setError(null);
    try {
      // Resolve the run target. A host runs as an executor; a cloud agent runs
      // AS its model (no host — the gateway/fleet executes it).
      const isHost = target.startsWith('host:');
      const cloudAgent = target.startsWith('cloud:')
        ? cloudAgents.find((a) => `cloud:${a.ref}` === target)
        : null;
      const agentHostId = isHost ? Number(target.slice('host:'.length)) : undefined;
      const effectiveModel = model || cloudAgent?.baseModel || '';
      // Forward the chosen model (explicit, or the cloud agent's own) and the
      // cloud agent ref so the API can resolve its runtime engine (V1/V2).
      const payloadObj: { model?: string; cloudAgentRef?: string } = {};
      if (effectiveModel) payloadObj.model = effectiveModel;
      if (cloudAgent?.ref) payloadObj.cloudAgentRef = cloudAgent.ref;
      const result = await runtimeApi.submitExecution({
        taskId: task.id,
        agentHostId,
        payload: Object.keys(payloadObj).length > 0 ? JSON.stringify(payloadObj) : undefined,
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
        <Select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...selectStyle, border: 'none', borderRight: '1px solid var(--border-subtle)' }} title="Agent">
          <option value="">Auto (any agent)</option>
          {(() => {
            // Always include the ticket's assigned cloud agent, even if the pool
            // hasn't loaded it yet, so the default selection never renders blank.
            const opts = cloudAgents.map((a) => ({ ref: a.ref, name: a.name }));
            if (task.assignedAgentRef && !opts.some((o) => o.ref === task.assignedAgentRef)) {
              opts.unshift({ ref: task.assignedAgentRef, name: 'Assigned agent' });
            }
            return opts.length > 0 ? (
              <optgroup label="Cloud agents">
                {opts.map((a) => (
                  <option key={`cloud:${a.ref}`} value={`cloud:${a.ref}`}>{a.name}</option>
                ))}
              </optgroup>
            ) : null;
          })()}
          {agentHosts.length > 0 && (
            <optgroup label="Self-hosted agents">
              {agentHosts.map((c) => (
                <option key={`host:${c.id}`} value={`host:${c.id}`}>{c.name}{c.online ? '' : ' (offline)'}</option>
              ))}
            </optgroup>
          )}
        </Select>
        <Select value={model} onChange={(e) => setModel(e.target.value)} style={{ ...selectStyle, border: 'none', borderRight: '1px solid var(--border-subtle)' }} title="LLM model">
          <option value="">{DEFAULT_MODEL_LABEL}</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
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
