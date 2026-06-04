'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { agentHosts, tenantDefaultAgentHost, type AgentHost, type AgentHostRegistration } from '@/lib/builderforceApi';
import { listAgents, hireAgent } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { AgentHostSlideOutPanel } from '@/components/AgentHostSlideOutPanel';
import { FleetMeshContent } from '@/components/FleetMeshContent';
import { CloudAgentsSection } from '@/components/workforce/CloudAgentsSection';
import { UpgradeModal } from '@/components/UpgradeModal';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';
import type { PublishedAgent } from '@/lib/types';

function AgentHostCard({
  agentHost,
  isDefault,
  onClick,
}: {
  agentHost: AgentHost;
  isDefault?: boolean;
  onClick: () => void;
}) {
  const connected = !!agentHost.connectedAt;
  const lastSeen = agentHost.lastSeenAt ? new Date(agentHost.lastSeenAt).toLocaleString() : '—';

  return (
    <div
      className="card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={{
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        position: 'relative',
        cursor: 'pointer',
      }}
    >
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        {isDefault && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6, background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)' }}>
            Default
          </span>
        )}
        <span className={connected ? 'badge-green' : ''} style={!connected ? { background: 'var(--bg-elevated)', color: 'var(--muted)', padding: '2px 8px', borderRadius: 9999, fontSize: 11 } : {}}>
          {connected ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>{agentHost.name}</div>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{agentHost.slug ?? agentHost.name}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Last seen {lastSeen}</div>
      <div style={{ marginTop: 4 }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
        >
          Open
        </button>
      </div>
    </div>
  );
}

export default function WorkforcePage() {
  const { tenant } = useAuth();
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [loadingAgentHosts, setLoadingAgentHosts] = useState(true);
  const [agentHostError, setAgentHostError] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [registerName, setRegisterName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [newAgentHost, setNewAgentHost] = useState<AgentHostRegistration | null>(null);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

  const [selectedAgentHost, setSelectedAgentHost] = useState<AgentHost | null>(null);
  const [defaultAgentHostId, setDefaultAgentHostId] = useState<number | null>(null);
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);

  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [hiringId, setHiringId] = useState<string | null>(null);

  const loadAgentHosts = useCallback(async () => {
    setLoadingAgentHosts(true);
    setAgentHostError('');
    try {
      const list = await agentHosts.list();
      setAgentHostList(list);
    } catch (e) {
      setAgentHostError(e instanceof Error ? e.message : 'Failed to load agentHosts');
    } finally {
      setLoadingAgentHosts(false);
    }
  }, []);

  useEffect(() => {
    loadAgentHosts();
  }, [loadAgentHosts]);

  const tenantId = tenant?.id != null ? Number(tenant.id) : undefined;
  useEffect(() => {
    if (tenantId == null) return;
    tenantDefaultAgentHost.get(tenantId).then(setDefaultAgentHostId).catch(() => setDefaultAgentHostId(null));
  }, [tenantId]);

  const handleSetDefaultAgentHost = useCallback(
    async (agentHostId: number | null) => {
      if (tenantId == null) return;
      const next = await tenantDefaultAgentHost.set(tenantId, agentHostId);
      setDefaultAgentHostId(next);
    },
    [tenantId]
  );

  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch(() => {})
      .finally(() => setLoadingAgents(false));
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerName.trim() || registering) return;
    setRegistering(true);
    setRegisterError('');
    try {
      const result = await agentHosts.register(registerName.trim());
      setNewAgentHost(result);
      setAgentHostList((prev) => [result, ...prev]);
      setRegisterName('');
    } catch (e) {
      if (isPlanLimitError(e)) {
        setShowRegisterModal(false);
        setPlanError(e);
      } else {
        setRegisterError(e instanceof Error ? e.message : 'Registration failed');
      }
    } finally {
      setRegistering(false);
    }
  };

  const closeRegisterModal = () => {
    setShowRegisterModal(false);
    setNewAgentHost(null);
    setRegisterName('');
    setRegisterError('');
    setApiKeyCopied(false);
  };

  const copyApiKey = async () => {
    if (!newAgentHost?.apiKey) return;
    try {
      await navigator.clipboard.writeText(newAgentHost.apiKey);
      setApiKeyCopied(true);
      setTimeout(() => setApiKeyCopied(false), 2000);
    } catch { /* ignore */ }
  };

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
            Create cloud agents, register remote agents (agentHosts), and connect them to your workspace. Publish agents to the marketplace to earn revenue.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setShowRegisterModal(true)}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 600,
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            + Register remote agent
          </button>
        </div>
      </div>

      {agentHostError && (
        <div style={{ marginBottom: 16, padding: '10px 14px', fontSize: 13, background: 'var(--error-bg)', color: 'var(--error-text)', borderRadius: 8 }}>
          {agentHostError}
        </div>
      )}

      {loadingAgentHosts ? (
        <div style={{ color: 'var(--muted)', fontSize: 14, padding: 24 }}>Loading agentHosts…</div>
      ) : agentHostList.length === 0 ? (
        <div className="empty-state" style={{ padding: 48 }}>
          <div className="empty-state-icon">📁</div>
          <div className="empty-state-title">No remote agents yet</div>
          <div className="empty-state-sub">Register a BuilderForce Agents instance to add it to your workforce, or create a cloud agent below.</div>
          <button
            type="button"
            onClick={() => setShowRegisterModal(true)}
            style={{ marginTop: 14, padding: '10px 18px', fontSize: 14, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer' }}
          >
            Register remote agent
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {agentHostList.map((agentHost) => (
            <AgentHostCard
              key={agentHost.id}
              agentHost={agentHost}
              isDefault={defaultAgentHostId != null && agentHost.id === defaultAgentHostId}
              onClick={() => setSelectedAgentHost(agentHost)}
            />
          ))}
        </div>
      )}

      {selectedAgentHost && (
        <AgentHostSlideOutPanel
          agentHost={selectedAgentHost}
          open={!!selectedAgentHost}
          onClose={() => setSelectedAgentHost(null)}
          tenantId={tenantId ?? undefined}
          defaultAgentHostId={defaultAgentHostId}
          onSetDefaultAgentHost={tenantId != null ? handleSetDefaultAgentHost : undefined}
        />
      )}

      {/* Fleet mesh visualization */}
      {agentHostList.length > 1 && (
        <section style={{ marginTop: 36 }}>
          <FleetMeshContent agentHosts={agentHostList} />
        </section>
      )}

      {/* Your cloud agents — create, manage, publish */}
      <CloudAgentsSection />

      {/* Marketplace / Hire agents section */}
      <section style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 8 }}>Workforce Registry</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          Browse and hire published AI agents. <Link href="/dashboard" style={{ color: 'var(--accent)' }}>Publish your agent</Link> from a project.
        </p>
        {loadingAgents && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading agents…</div>}
        {!loadingAgents && agents.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No agents published yet.</div>
        )}
        {!loadingAgents && agents.length > 0 && (
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
        )}
      </section>

      {/* Register agentHost modal */}
      {showRegisterModal && (
        <div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && closeRegisterModal()}
        >
          <div
            className="card"
            style={{ maxWidth: 440, width: '100%', padding: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            {!newAgentHost ? (
              <>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 4 }}>Register a remote agent</h3>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>Give your remote agent (BuilderForce Agents instance) a name. You’ll get an API key to paste into its config.</p>
                <form onSubmit={handleRegister}>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-strong)', marginBottom: 6 }}>Name</label>
                    <input
                      type="text"
                      value={registerName}
                      onChange={(e) => setRegisterName(e.target.value)}
                      placeholder="e.g. openclaw-bridge-node"
                      style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: 13 }}
                      autoFocus
                    />
                  </div>
                  {registerError && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--error-text)' }}>{registerError}</div>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={closeRegisterModal} style={{ padding: '8px 16px', fontSize: 13, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                    <button type="submit" disabled={registering || !registerName.trim()} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                      {registering ? 'Registering…' : 'Register'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 4 }}>Remote agent registered</h3>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Copy the API key and add it to your remote agent’s environment. It won’t be shown again.</p>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-strong)', marginBottom: 6 }}>API Key</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="password"
                      readOnly
                      value={newAgentHost.apiKey}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                    />
                    <button type="button" onClick={copyApiKey} style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                      {apiKeyCopied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={closeRegisterModal} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <UpgradeModal error={planError} onClose={() => setPlanError(null)} />
    </div>
  );
}
