'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { projectAgents, type ProjectAgent } from '@/lib/builderforceApi';
import { loadAgentPool, AGENT_KIND_LABEL, type PoolAgent } from '@/lib/agentPool';
import { CapabilitiesContent } from './CapabilitiesContent';
import { CronJobsContent } from './CronJobsContent';

export interface AgentCapabilitiesContentProps {
  projectId: number;
  /** Tenant ID for content block name resolution. */
  tenantId?: string;
  /** Executor agentHost for this project — required to schedule cron runs. */
  agentHostId?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The "Agent / Capabilities" panel. Lists the agents attached to a project and
 * lets capabilities (skills/personas/content/governance) be assigned either
 * project-wide or scoped to a single agent. Reuses {@link CapabilitiesContent}
 * for the section UI; the agent target only changes the scope/scopeId passed in.
 */
export function AgentCapabilitiesContent({ projectId, tenantId, agentHostId, className, style }: AgentCapabilitiesContentProps) {
  const [attached, setAttached] = useState<ProjectAgent[]>([]);
  const [pool, setPool] = useState<PoolAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  /** null = project-wide; otherwise the selected ProjectAgent.id. */
  const [target, setTarget] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, poolAgents] = await Promise.all([projectAgents.list(projectId), loadAgentPool({ projectId })]);
      setAttached(list);
      setPool(poolAgents);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const attachedKeys = useMemo(
    () => new Set(attached.map((a) => `${a.agentKind}:${a.agentRef}`)),
    [attached],
  );
  const available = useMemo(
    () => pool.filter((p) => !attachedKeys.has(`${p.kind}:${p.ref}`)),
    [pool, attachedKeys],
  );

  const handleAdd = async (p: PoolAgent) => {
    setBusy(true);
    setError(null);
    try {
      await projectAgents.add({ projectId, agentKind: p.kind, agentRef: p.ref, name: p.name });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add agent');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (agent: ProjectAgent) => {
    if (!confirm(`Remove "${agent.name}" from this project? Its per-agent capabilities will be cleared.`)) return;
    setBusy(true);
    setError(null);
    try {
      await projectAgents.remove(agent.id);
      if (target === agent.id) setTarget(null);
      setAttached((prev) => prev.filter((a) => a.id !== agent.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove agent');
    } finally {
      setBusy(false);
    }
  };

  const selectedAgent = target != null ? attached.find((a) => a.id === target) ?? null : null;

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 16, ...style }}>
      {/* Agents */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Agents ({attached.length})</div>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--coral-bright)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {showAdd ? 'Done' : '+ Add Agent'}
          </button>
        </div>

        {error && <div style={{ padding: '8px 12px', fontSize: 12, background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: 8 }}>{error}</div>}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : showAdd ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {available.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12 }}>
                No more custom agents to add. Create agents in Workforce or register one in Settings.
              </div>
            ) : (
              available.map((p) => (
                <div
                  key={`${p.kind}:${p.ref}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                  }}
                >
                  <AgentKindBadge kind={p.kind} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.meta}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAdd(p)}
                    disabled={busy}
                    style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff', border: 'none', borderRadius: 6, cursor: busy ? 'wait' : 'pointer', flexShrink: 0 }}
                  >
                    Add
                  </button>
                </div>
              ))
            )}
          </div>
        ) : attached.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>
            No agents on this project yet. Click &quot;+ Add Agent&quot; to assign your custom agents.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {attached.map((a) => (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                }}
              >
                <AgentKindBadge kind={a.agentKind} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{a.name}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(a)}
                  disabled={busy}
                  style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, cursor: busy ? 'wait' : 'pointer', flexShrink: 0 }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Capability target selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Capabilities for:</span>
        <button
          type="button"
          onClick={() => setTarget(null)}
          style={chipStyle(target === null)}
        >
          Project-wide
        </button>
        {attached.map((a) => (
          <button key={a.id} type="button" onClick={() => setTarget(a.id)} style={chipStyle(target === a.id)}>
            {a.name}
          </button>
        ))}
      </div>

      {/* Sections — scoped to project-wide or the selected agent */}
      {selectedAgent ? (
        <CapabilitiesContent
          scope="agent"
          scopeId={selectedAgent.id}
          projectId={projectId}
          agentAssignment={selectedAgent}
          tenantId={tenantId}
        />
      ) : (
        <CapabilitiesContent
          scope="project"
          scopeId={projectId}
          projectId={projectId}
          tenantId={tenantId}
        />
      )}

      {/* Scheduled runs (cron) — available once an agent is assigned to the project.
          Crons execute on the project's agentHost and are project-scoped today
          (not yet per-assigned-agent — see gap register). */}
      {attached.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            Scheduled runs (Cron)
            {selectedAgent && (
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}> · {selectedAgent.name}</span>
            )}
          </div>
          {agentHostId ? (
            <CronJobsContent
              agentHostId={agentHostId}
              projectId={projectId}
              projectAgentId={selectedAgent ? selectedAgent.id : 'none'}
              hideProjectColumn
            />
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 16, textAlign: 'center', background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
              Assign an agent host (Cloud or On-Premise) to this project to schedule cron runs.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentKindBadge({ kind }: { kind: PoolAgent['kind'] }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        padding: '2px 6px',
        borderRadius: 6,
        flexShrink: 0,
        background: kind === 'workforce' ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
        color: kind === 'workforce' ? 'var(--coral-bright)' : 'var(--text-muted)',
      }}
    >
      {AGENT_KIND_LABEL[kind]}
    </span>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    color: active ? 'var(--coral-bright)' : 'var(--text-muted)',
    background: active ? 'rgba(255,107,53,0.08)' : 'transparent',
    border: `1px solid ${active ? 'var(--border-accent, var(--coral-bright))' : 'var(--border-subtle)'}`,
    borderRadius: 8,
    cursor: 'pointer',
  };
}
