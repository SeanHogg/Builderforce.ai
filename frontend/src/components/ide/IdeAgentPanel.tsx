'use client';

import { useEffect, useState, useCallback } from 'react';
import { Select } from '@/components/Select';
import { tasksApi, agentHosts as agentHostsApi, type Task, type AgentHost } from '@/lib/builderforceApi';
import { RunAgentControl } from '@/components/task/RunAgentControl';
import { AgentExecutionPanel } from '@/components/agent/AgentExecutionPanel';

/**
 * IdeAgentPanel — run a cloud agent / AI prompt against this project from inside
 * the Designer, exactly like the VS Code plugin: pick (or create from a prompt) a
 * task, dispatch via the shared run pipeline, and watch Output + Changes live.
 *
 * Reuses the task→execution machinery wholesale (RunAgentControl + AgentExecutionPanel)
 * so the IDE never forks the agent loop — the same branch/PR/Changes flow as the board.
 */
export function IdeAgentPanel({ projectId }: { projectId: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hosts, setHosts] = useState<AgentHost[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(() => {
    tasksApi.list(projectId).then((list) => {
      setTasks(list);
      setSelectedId((cur) => cur ?? (list[0]?.id ?? null));
    }).catch(() => setError('Failed to load tasks.'));
  }, [projectId]);

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => { agentHostsApi.list().then(setHosts).catch(() => setHosts([])); }, []);

  // "AI Prompt" → a task. Creating a task from the prompt then dispatching an agent
  // against it reuses the full pipeline (PRD, branch, PR, Changes) — no fork.
  const createFromPrompt = async () => {
    const title = prompt.trim();
    if (!title || creating) return;
    setCreating(true);
    setError(null);
    try {
      const task = await tasksApi.create({ projectId, title });
      setPrompt('');
      setTasks((prev) => [task, ...prev]);
      setSelectedId(task.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
        {/* New AI prompt → task */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createFromPrompt(); }}
            placeholder="Describe a task for the agent…"
            style={{ flex: 1, padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-deep)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={createFromPrompt}
            disabled={creating || !prompt.trim()}
            style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, background: 'var(--coral-bright)', color: '#fff', cursor: creating || !prompt.trim() ? 'default' : 'pointer', opacity: creating || !prompt.trim() ? 0.7 : 1, whiteSpace: 'nowrap' }}
          >
            {creating ? 'Adding…' : '+ Task'}
          </button>
        </div>

        {/* Existing task selector */}
        {tasks.length > 0 && (
          <Select
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
            style={{ padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-deep)', color: 'var(--text-primary)' }}
          >
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Select>
        )}

        {selected && (
          <RunAgentControl task={selected} agentHosts={hosts} onRan={loadTasks} />
        )}
        {error && <div style={{ fontSize: 12, color: 'var(--danger, #dc2626)' }}>{error}</div>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {selected ? (
          <AgentExecutionPanel task={selected} agentHosts={hosts} onTaskChanged={loadTasks} />
        ) : (
          <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
            Describe a task above to run an agent against this project.
          </div>
        )}
      </div>
    </div>
  );
}
