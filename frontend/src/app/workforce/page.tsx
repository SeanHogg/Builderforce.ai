'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { listAgents, hireAgent } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { WorkforceAgents } from '@/components/workforce/WorkforceAgents';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import type { PublishedAgent } from '@/lib/types';

export default function WorkforcePage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id != null ? Number(tenant.id) : undefined;

  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [hiringId, setHiringId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch(() => {})
      .finally(() => setLoadingAgents(false));
  }, []);

  const handleHire = useCallback(async (agentId: string) => {
    setHiringId(agentId);
    try {
      const updated = await hireAgent(agentId);
      setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)));
    } catch { /* noop */ }
    finally {
      setHiringId(null);
    }
  }, []);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>Workforce</h1>
          <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Create cloud agents, register remote agents, and connect them to your workspace. Publish agents to the marketplace to earn revenue.
          </p>
        </div>
      </div>

      {/* Unified agent directory — cloud agents + remote agentHosts, one grid */}
      <WorkforceAgents tenantId={tenantId} />

      {/* Marketplace / Hire agents section */}
      <section style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>Workforce Registry</h2>
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          Browse and hire published AI agents. <Link href="/dashboard" style={{ color: 'var(--accent)' }}>Publish your agent</Link> from a project.
        </p>
        {loadingAgents && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading agents…</div>}
        {!loadingAgents && agents.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No agents published yet.</div>
        )}
        {!loadingAgents && agents.length > 0 && (
          viewMode === 'card' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {agents.slice(0, 6).map((agent) => (
                <div key={agent.id} className="card" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-strong)', marginBottom: 4 }}>{agent.name}</div>
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.title}</p>
                  <button
                    type="button"
                    onClick={() => handleHire(agent.id)}
                    disabled={hiringId === agent.id}
                    style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                  >
                    {hiringId === agent.id ? 'Hiring…' : 'Hire'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr style={theadRowStyle}>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Title</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.slice(0, 6).map((agent) => (
                    <tr key={agent.id} style={trStyle}>
                      <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--text-strong)' }}>{agent.name}</td>
                      <td style={tdMutedStyle}>{agent.title}</td>
                      <td style={tdStyle}>
                        <button
                          type="button"
                          onClick={() => handleHire(agent.id)}
                          disabled={hiringId === agent.id}
                          style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                        >
                          {hiringId === agent.id ? 'Hiring…' : 'Hire'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>
    </div>
  );
}
