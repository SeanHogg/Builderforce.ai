'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { claws, type Claw, type ClawRegistration } from '@/lib/builderforceApi';
import { listAgents, hireAgent } from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';

function ClawCard({ claw }: { claw: Claw }) {
  const connected = !!claw.connectedAt;
  const lastSeen = claw.lastSeenAt ? new Date(claw.lastSeenAt).toLocaleString() : '—';

  return (
    <div
      className="card"
      style={{
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', top: 12, right: 12 }}>
        <span className={connected ? 'badge-green' : ''} style={!connected ? { background: 'var(--bg-elevated)', color: 'var(--muted)', padding: '2px 8px', borderRadius: 9999, fontSize: 11 } : {}}>
          {connected ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)' }}>{claw.name}</div>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{claw.name}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Last seen {lastSeen}</div>
    </div>
  );
}

export default function WorkforcePage() {
  const [clawList, setClawList] = useState<Claw[]>([]);
  const [loadingClaws, setLoadingClaws] = useState(true);
  const [clawError, setClawError] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [registerName, setRegisterName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [newClaw, setNewClaw] = useState<ClawRegistration | null>(null);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [hiringId, setHiringId] = useState<string | null>(null);

  const loadClaws = useCallback(async () => {
    setLoadingClaws(true);
    setClawError('');
    try {
      const list = await claws.list();
      setClawList(list);
    } catch (e) {
      setClawError(e instanceof Error ? e.message : 'Failed to load claws');
    } finally {
      setLoadingClaws(false);
    }
  }, []);

  useEffect(() => {
    loadClaws();
  }, [loadClaws]);

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
      const result = await claws.register(registerName.trim());
      setNewClaw(result);
      setClawList((prev) => [result, ...prev]);
      setRegisterName('');
    } catch (e) {
      setRegisterError(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setRegistering(false);
    }
  };

  const closeRegisterModal = () => {
    setShowRegisterModal(false);
    setNewClaw(null);
    setRegisterName('');
    setRegisterError('');
    setApiKeyCopied(false);
  };

  const copyApiKey = async () => {
    if (!newClaw?.apiKey) return;
    try {
      await navigator.clipboard.writeText(newClaw.apiKey);
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
            Register and manage your CoderClaw instances (claws). Connect agents to your workspace and hire from the registry.
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
            + Register claw
          </button>
        </div>
      </div>

      {clawError && (
        <div style={{ marginBottom: 16, padding: '10px 14px', fontSize: 13, background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: 8 }}>
          {clawError}
        </div>
      )}

      {loadingClaws ? (
        <div style={{ color: 'var(--muted)', fontSize: 14, padding: 24 }}>Loading claws…</div>
      ) : clawList.length === 0 ? (
        <div className="empty-state" style={{ padding: 48 }}>
          <div className="empty-state-icon">📁</div>
          <div className="empty-state-title">No claws yet</div>
          <div className="empty-state-sub">Create your first project to start organizing work</div>
          <button
            type="button"
            onClick={() => setShowRegisterModal(true)}
            style={{ marginTop: 14, padding: '10px 18px', fontSize: 14, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer' }}
          >
            Register claw
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {clawList.map((claw) => (
            <ClawCard key={claw.id} claw={claw} />
          ))}
        </div>
      )}

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

      {/* Register claw modal */}
      {showRegisterModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={(e) => e.target === e.currentTarget && closeRegisterModal()}
        >
          <div
            className="card"
            style={{ maxWidth: 440, width: '100%', padding: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            {!newClaw ? (
              <>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 4 }}>Register a claw</h3>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>Give your CoderClaw instance a name. You’ll get an API key to paste into your claw config.</p>
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
                  {registerError && <div style={{ marginBottom: 12, fontSize: 13, color: '#ef4444' }}>{registerError}</div>}
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
                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 4 }}>Claw registered</h3>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Copy the API key and add it to your claw environment. It won’t be shown again.</p>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-strong)', marginBottom: 6 }}>API Key</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="password"
                      readOnly
                      value={newClaw.apiKey}
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
    </div>
  );
}
