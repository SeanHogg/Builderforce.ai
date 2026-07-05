'use client';

import { Select } from '@/components/Select';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  runtimeApi,
  reposApi,
  type Task,
  type AgentHost,
  type TaskRepoStatus,
  type ProjectRepository,
} from '@/lib/builderforceApi';
import { useLlmModels } from '@/lib/useLlmModels';
import { ModelSelect } from '@/components/llm/ModelSelect';
import { useTaskRunner, defaultRunTarget } from './useTaskRunner';

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
  // Default to the ticket's assignee so the control reflects who actually runs it.
  const [target, setTarget] = useState<string>(defaultRunTarget(task));
  const [model, setModel] = useState<string>('');
  // Full plan pool + the curated tool-calling/coding subset, from the shared loader.
  // `canChooseModel` gates the model picker — a paid plan OR a connected provider
  // (BYO) may choose the model; a free plan with nothing connected runs
  // Builderforce's managed default (the server enforces this too, in pickCloudModel
  // + the strict-pin gate, so such a run never honours an explicit pick).
  const { canChooseModel } = useLlmModels();
  // Single shared submit path (also powers the one-click RunTaskButton). It owns
  // the run state + cloud-agent pool; we drive it with the picker's target/model.
  const { run, running, error, cloudAgents } = useTaskRunner({ task, onRan, onAwaitingApproval });
  const [repoStatus, setRepoStatus] = useState<TaskRepoStatus | null>(null);
  // Run-time repo selection. '' = Auto (default/inferred); a repo id pins this run
  // (and its finalize/CI/PRD) to that repo. Defaults to the task's existing pin so
  // reopening reflects the bound repo — fixes "agent ran against the wrong repo".
  const [repos, setRepos] = useState<ProjectRepository[]>([]);
  const [repoId, setRepoId] = useState<string>(task.explicitRepoId ?? '');

  // Surface "the agent can't commit" before a run silently degrades to a text
  // summary. Re-checked when the task changes (binding happens in Source Control).
  useEffect(() => {
    runtimeApi.taskRepoStatus(task.id).then(setRepoStatus).catch(() => setRepoStatus(null));
  }, [task.id]);

  // The project's repos, for the run-time repo picker (only shown when >1 exists).
  useEffect(() => {
    reposApi.list(task.projectId).then(setRepos).catch(() => setRepos([]));
  }, [task.projectId]);

  return (
    <div>
      {/* Fills the available width and lets the two selects shrink (min-width:0
          → the trigger's label ellipsis kicks in) so long model names don't push
          the group past a narrow panel on mobile. Run stays fixed on the right. */}
      <div style={{ display: 'flex', width: '100%', maxWidth: '100%', alignItems: 'stretch', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden' }}>
        <Select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...selectStyle, flex: '1 1 0', minWidth: 0, border: 'none', borderRight: '1px solid var(--border-subtle)' }} title="Agent">
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
        {(() => {
          // A cloud-agent run is a multi-turn tool loop, so restrict its model
          // picker to the curated tool-calling + coding list (the gateway pins one
          // for the whole run). A self-hosted/auto run keeps the full pool.
          const isCloud = target.startsWith('cloud:');
          const defaultLabel = isCloud ? 'builderforce.ai (best coding model)' : DEFAULT_MODEL_LABEL;
          // No model choice (free plan, nothing connected) — Builderforce manages
          // it. Show a static, non-interactive managed-default label instead of the
          // picker (the server ignores an explicit pick regardless). Paid plans OR
          // a connected provider (BYO) get the full dropdown.
          if (!canChooseModel) {
            return (
              <div
                style={{ ...selectStyle, flex: '1 1 0', minWidth: 0, border: 'none', borderRight: '1px solid var(--border-subtle)', cursor: 'default', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}
                title="Model selection is a paid-plan feature — free runs use Builderforce's managed default"
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{defaultLabel}</span>
                <Link href="/pricing" style={{ fontSize: 10, fontWeight: 700, color: 'var(--coral-bright)', textDecoration: 'none', flexShrink: 0 }}>PRO</Link>
              </div>
            );
          }
          return (
            <ModelSelect
              value={model}
              onChange={setModel}
              variant={isCloud ? 'coding' : 'all'}
              defaultLabel={defaultLabel}
              style={{ ...selectStyle, flex: '1 1 0', minWidth: 0, border: 'none', borderRight: '1px solid var(--border-subtle)' }}
              title="LLM model"
            />
          );
        })()}
        {/* Repo picker — only when the project has >1 repo (otherwise there's
            nothing to choose; a single/zero-repo project auto-resolves). Lets a run
            target the RIGHT repo instead of the project default. */}
        {repos.length > 1 && (
          <Select value={repoId} onChange={(e) => setRepoId(e.target.value)} style={{ ...selectStyle, flex: '1 1 0', minWidth: 0, border: 'none', borderRight: '1px solid var(--border-subtle)' }} title="Repository">
            <option value="">Auto (default repo)</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>{r.owner}/{r.repo}{r.isDefault ? ' (default)' : ''}</option>
            ))}
          </Select>
        )}
        <button
          type="button"
          onClick={() => run({ target, model, ...(repos.length > 1 ? { repoId } : {}) })}
          disabled={running}
          style={{
            padding: '7px 16px', fontSize: 13, fontWeight: 600, border: 'none',
            background: 'var(--coral-bright)', color: '#fff', cursor: running ? 'default' : 'pointer',
            opacity: running ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6,
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          {running ? 'Running…' : 'Run'}
          {!running && (
            <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: 'currentColor' }}><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)', marginTop: 6 }}>{error}</div>}
      {repoStatus && (!repoStatus.bound || !repoStatus.hasCredential) && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, padding: '8px 10px', background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
          <span style={{ color: 'var(--amber, #f59e0b)', fontWeight: 600 }}>⚠ No writable repo. </span>
          {repoStatus.bound
            ? 'This task’s repo has no usable credential, so the agent can’t commit or ship code — it will only return a text summary. '
            : 'No repository is bound to this task, so the agent can’t commit or ship code — it will only return a text summary. '}
          <Link href={`/projects/${task.projectId}`} style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>Open project → Integrations → Source Control →</Link>
        </div>
      )}
    </div>
  );
}
