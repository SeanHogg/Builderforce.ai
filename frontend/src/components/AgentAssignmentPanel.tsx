'use client';

import { Select } from '@/components/Select';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  agentAssignmentsApi,
  type AgentAssignment,
  type AgentAssignmentScope,
  type AgentExecutionScope,
} from '@/lib/builderforceApi';
import { loadAgentPool, AGENT_KIND_LABEL, type PoolAgent } from '@/lib/agentPool';

export interface AgentAssignmentPanelProps {
  /** Which platform aspect agents are being assigned to. */
  scope: AgentAssignmentScope;
  /** Target id within the scope (project/workflow/swimlane id). Omit for brain/global/tenant-wide. */
  scopeId?: string | number;
  /** Show a per-assignment project|global execution-scope toggle (e.g. workflows). */
  showExecutionScope?: boolean;
  title?: string;
  emptyHint?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The single reusable "assign agents to X" control. Lists the tenant's agents
 * and toggles their assignment to the given scope/target via the canonical
 * agent-assignments API — so the Brain, architecture, security, workflow and
 * project surfaces all share one assignment UI (DRY) instead of bespoke pickers.
 */
export function AgentAssignmentPanel({
  scope,
  scopeId,
  showExecutionScope = false,
  title = 'Assigned agents',
  emptyHint = 'No agents assigned. Pick one below.',
  className,
  style,
}: AgentAssignmentPanelProps) {
  const [assignments, setAssignments] = useState<AgentAssignment[]>([]);
  const [pool, setPool] = useState<PoolAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, poolAgents] = await Promise.all([
        agentAssignmentsApi.list(scope, scopeId),
        loadAgentPool(),
      ]);
      setAssignments(list);
      setPool(poolAgents);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  }, [scope, scopeId]);

  useEffect(() => { load(); }, [load]);

  const assignedKeys = useMemo(
    () => new Set(assignments.map((a) => `${a.agentKind}:${a.agentRef}`)),
    [assignments],
  );
  const available = useMemo(
    () => pool.filter((p) => !assignedKeys.has(`${p.kind}:${p.ref}`)),
    [pool, assignedKeys],
  );
  const nameFor = useCallback(
    (a: AgentAssignment) => pool.find((p) => p.kind === a.agentKind && p.ref === a.agentRef)?.name ?? `${a.agentKind}:${a.agentRef}`,
    [pool],
  );

  const assign = async (p: PoolAgent, executionScope: AgentExecutionScope = 'project') => {
    setBusy(true);
    setError(null);
    try {
      const created = await agentAssignmentsApi.assign({
        agentKind: p.kind,
        agentRef: p.ref,
        scope,
        scopeId: scopeId ?? null,
        executionScope,
      });
      setAssignments((prev) => [...prev.filter((a) => a.id !== created.id), created]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign');
    } finally {
      setBusy(false);
    }
  };

  const setExecutionScope = async (a: AgentAssignment, executionScope: AgentExecutionScope) => {
    setBusy(true);
    try {
      const updated = await agentAssignmentsApi.assign({
        agentKind: a.agentKind,
        agentRef: a.agentRef,
        scope,
        scopeId: scopeId ?? null,
        executionScope,
      });
      setAssignments((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: AgentAssignment) => {
    setBusy(true);
    setError(null);
    try {
      await agentAssignmentsApi.remove(a.id);
      setAssignments((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{title} ({assignments.length})</div>
        <button type="button" onClick={() => setShowAdd((v) => !v)} style={primaryBtn}>{showAdd ? 'Done' : '+ Assign agent'}</button>
      </div>

      {error && <div style={{ padding: '8px 12px', fontSize: 12, background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: 8 }}>{error}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {assignments.length === 0 && !showAdd && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 12, textAlign: 'center' }}>{emptyHint}</div>
          )}
          {assignments.map((a) => (
            <div key={a.id} style={rowStyle}>
              <span style={kindBadge(a.agentKind)}>{AGENT_KIND_LABEL[a.agentKind as PoolAgent['kind']] ?? a.agentKind}</span>
              <div style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{nameFor(a)}</div>
              {showExecutionScope && (
                <Select
                  value={a.executionScope}
                  onChange={(e) => setExecutionScope(a, e.target.value as AgentExecutionScope)}
                  disabled={busy}
                  style={selectStyle}
                  aria-label="Execution scope"
                >
                  <option value="project">runs under project</option>
                  <option value="global">runs globally</option>
                </Select>
              )}
              <button type="button" onClick={() => remove(a)} disabled={busy} style={dangerBtn}>Remove</button>
            </div>
          ))}

          {showAdd && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {available.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12 }}>
                  No more agents to assign. Create agents in Workforce or register one in Settings.
                </div>
              ) : (
                available.map((p) => (
                  <div key={`${p.kind}:${p.ref}`} style={rowStyle}>
                    <span style={kindBadge(p.kind)}>{AGENT_KIND_LABEL[p.kind]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.meta}</div>
                    </div>
                    <button type="button" onClick={() => assign(p)} disabled={busy} style={addBtn}>Assign</button>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8,
};
const primaryBtn: React.CSSProperties = {
  padding: '5px 12px', fontSize: 12, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
};
const addBtn: React.CSSProperties = { ...primaryBtn, padding: '4px 10px', fontSize: 11, flexShrink: 0 };
const dangerBtn: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: '#ef4444',
  border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
};
const selectStyle: React.CSSProperties = {
  fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
};
function kindBadge(kind: string): React.CSSProperties {
  const wf = kind === 'workforce';
  return {
    fontSize: 10, fontWeight: 600, textTransform: 'uppercase', padding: '2px 6px', borderRadius: 6, flexShrink: 0,
    background: wf ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
    color: wf ? 'var(--coral-bright)' : 'var(--text-muted)',
  };
}
