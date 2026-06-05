'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  agentHosts,
  tenantDefaultAgentHost,
  type AgentHost,
  type AgentHostRegistration,
} from '@/lib/builderforceApi';
import {
  listMyAgents,
  createCloudAgent,
  updateAgent,
  deleteAgent,
  type CloudAgentInput,
  type AgentRuntimeSupport,
  type AgentPricingModel,
} from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';
import { AgentHostSlideOutPanel } from '@/components/AgentHostSlideOutPanel';
import { FleetMeshContent } from '@/components/FleetMeshContent';
import { UpgradeModal } from '@/components/UpgradeModal';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';

/**
 * Workforce → unified agent directory. Lists the tenant's cloud agents AND its
 * registered remote agentHosts in a single grid; a "Type" pill on each card
 * designates which is which. One "Add agent" dialog covers both: a Cloud/Remote
 * toggle swaps between the full cloud-agent form and the remote-registration
 * (name → API key) flow. Cloud agents can be published to the marketplace.
 */

const RUNTIME_LABELS: Record<AgentRuntimeSupport, string> = {
  cloud: 'Cloud only',
  host: 'Remote (self-hosted) only',
  both: 'Cloud + Remote',
};

type AgentKind = 'cloud' | 'host';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-strong)', marginBottom: 6 };
const btnPrimary: React.CSSProperties = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
const btnSubtle: React.CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-strong)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };

function priceLabel(a: PublishedAgent): string {
  if (!a.price_cents) return 'Free';
  const dollars = (a.price_cents / 100).toFixed(2);
  return a.pricing_model === 'consumption' ? `$${dollars}${a.price_unit ? ` / ${a.price_unit}` : ' / unit'}` : `$${dollars}`;
}

/** The "Cloud" / "Remote" designator pill shown on every card. */
function TypePill({ kind }: { kind: AgentKind }) {
  const remote = kind === 'host';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 6,
      background: remote ? 'var(--bg-elevated)' : 'var(--surface-coral-soft)',
      color: remote ? 'var(--text-strong)' : 'var(--accent)',
      border: '1px solid var(--border)',
    }}>
      {remote ? 'Remote' : 'Cloud'}
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  padding: 16, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative',
};

interface FormState {
  id?: string;
  name: string;
  title: string;
  bio: string;
  skills: string;
  baseModel: string;
  runtimeSupport: AgentRuntimeSupport;
  preferredRuntime: 'cloud' | 'host';
}

const EMPTY_FORM: FormState = {
  name: '', title: '', bio: '', skills: '', baseModel: '', runtimeSupport: 'cloud', preferredRuntime: 'cloud',
};

export function WorkforceAgents({ tenantId }: { tenantId?: number }) {
  // --- Remote agentHosts ---------------------------------------------------
  const [hosts, setHosts] = useState<AgentHost[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [defaultAgentHostId, setDefaultAgentHostId] = useState<number | null>(null);
  const [selectedHost, setSelectedHost] = useState<AgentHost | null>(null);

  // --- Cloud agents --------------------------------------------------------
  const [cloudAgents, setCloudAgents] = useState<PublishedAgent[]>([]);
  const [loadingCloud, setLoadingCloud] = useState(true);

  const [error, setError] = useState('');
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);

  // --- Unified "Add agent" dialog ------------------------------------------
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createKind, setCreateKind] = useState<AgentKind>('cloud');
  // cloud sub-state
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // remote sub-state
  const [registerName, setRegisterName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [newHost, setNewHost] = useState<AgentHostRegistration | null>(null);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

  // --- Publish (cloud) modal -----------------------------------------------
  const [publishTarget, setPublishTarget] = useState<PublishedAgent | null>(null);
  const [priceDollars, setPriceDollars] = useState('0');
  const [pricingModel, setPricingModel] = useState<AgentPricingModel>('flat_fee');
  const [priceUnit, setPriceUnit] = useState('');

  const loadHosts = useCallback(async () => {
    setLoadingHosts(true);
    try {
      setHosts(await agentHosts.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load remote agents');
    } finally {
      setLoadingHosts(false);
    }
  }, []);

  const loadCloud = useCallback(() => {
    setLoadingCloud(true);
    listMyAgents()
      .then(setCloudAgents)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load cloud agents'))
      .finally(() => setLoadingCloud(false));
  }, []);

  useEffect(() => { loadHosts(); loadCloud(); }, [loadHosts, loadCloud]);

  useEffect(() => {
    if (tenantId == null) return;
    tenantDefaultAgentHost.get(tenantId).then(setDefaultAgentHostId).catch(() => setDefaultAgentHostId(null));
  }, [tenantId]);

  const handleSetDefaultAgentHost = useCallback(
    async (agentHostId: number | null) => {
      if (tenantId == null) return;
      setDefaultAgentHostId(await tenantDefaultAgentHost.set(tenantId, agentHostId));
    },
    [tenantId]
  );

  // --- Dialog open/close ---------------------------------------------------
  const openCreate = (kind: AgentKind) => {
    setCreateKind(kind);
    setForm(EMPTY_FORM);
    setRegisterName('');
    setNewHost(null);
    setApiKeyCopied(false);
    setError('');
    setDialogOpen(true);
  };
  const openEdit = (a: PublishedAgent) => {
    setCreateKind('cloud');
    setForm({
      id: a.id, name: a.name, title: a.title, bio: a.bio,
      skills: (a.skills ?? []).join(', '),
      baseModel: a.base_model === 'builderforce-default' ? '' : a.base_model,
      runtimeSupport: a.runtime_support ?? 'cloud',
      preferredRuntime: (a.preferred_runtime as 'cloud' | 'host') ?? 'cloud',
    });
    setError('');
    setDialogOpen(true);
  };
  const closeDialog = () => {
    setDialogOpen(false);
    setForm(EMPTY_FORM);
    setRegisterName('');
    setNewHost(null);
    setApiKeyCopied(false);
    setError('');
  };

  // --- Cloud create / edit -------------------------------------------------
  const saveCloud = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    const payload: CloudAgentInput = {
      name: form.name.trim(),
      title: form.title.trim() || form.name.trim(),
      bio: form.bio.trim(),
      skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      baseModel: form.baseModel.trim() || undefined,
      runtimeSupport: form.runtimeSupport,
      preferredRuntime: form.runtimeSupport === 'both' ? form.preferredRuntime : null,
    };
    try {
      if (form.id) await updateAgent(form.id, payload);
      else await createCloudAgent(payload);
      closeDialog(); loadCloud();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // --- Remote register -----------------------------------------------------
  const registerHost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerName.trim() || registering) return;
    setRegistering(true); setError('');
    try {
      const result = await agentHosts.register(registerName.trim());
      setNewHost(result);
      setHosts((prev) => [result, ...prev]);
      setRegisterName('');
    } catch (e) {
      if (isPlanLimitError(e)) {
        closeDialog();
        setPlanError(e);
      } else {
        setError(e instanceof Error ? e.message : 'Registration failed');
      }
    } finally {
      setRegistering(false);
    }
  };

  const copyApiKey = async () => {
    if (!newHost?.apiKey) return;
    try {
      await navigator.clipboard.writeText(newHost.apiKey);
      setApiKeyCopied(true);
      setTimeout(() => setApiKeyCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // --- Publish -------------------------------------------------------------
  const openPublish = (a: PublishedAgent) => {
    setPublishTarget(a);
    setPriceDollars(((a.price_cents ?? 0) / 100).toFixed(2));
    setPricingModel(a.pricing_model ?? 'flat_fee');
    setPriceUnit(a.price_unit ?? '');
  };
  const confirmPublish = async () => {
    if (!publishTarget) return;
    const priceCents = Math.max(0, Math.round(parseFloat(priceDollars || '0') * 100));
    await updateAgent(publishTarget.id, {
      published: true,
      priceCents,
      pricingModel,
      priceUnit: pricingModel === 'consumption' ? (priceUnit.trim() || 'request') : null,
    });
    setPublishTarget(null); loadCloud();
  };
  const unpublish = async (a: PublishedAgent) => { await updateAgent(a.id, { published: false }); loadCloud(); };
  const removeCloud = async (a: PublishedAgent) => { if (confirm(`Delete agent "${a.name}"?`)) { await deleteAgent(a.id); loadCloud(); } };

  const loading = loadingHosts || loadingCloud;
  const isEmpty = hosts.length === 0 && cloudAgents.length === 0;
  const dialogTitle = form.id ? 'Edit cloud agent' : 'Add agent';

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>Agents</h2>
        <button type="button" onClick={() => openCreate('cloud')} style={btnPrimary}>+ Add agent</button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        Your cloud agents and registered remote agents (self-hosted BuilderForce Agents instances) in one place.
        Publish a cloud agent to the marketplace to earn revenue.
      </p>

      {error && !dialogOpen && !publishTarget && (
        <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--error-text)' }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: 24 }}>Loading agents…</div>
      ) : isEmpty ? (
        <div className="empty-state" style={{ padding: 48 }}>
          <div className="empty-state-icon">📁</div>
          <div className="empty-state-title">No agents yet</div>
          <div className="empty-state-sub">Create a cloud agent or register a remote (self-hosted) agent to start building your workforce.</div>
          <button type="button" onClick={() => openCreate('cloud')} style={{ ...btnPrimary, marginTop: 14, padding: '10px 18px', fontSize: 14, borderRadius: 10 }}>
            Add agent
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {/* Remote agentHosts */}
          {hosts.map((host) => {
            const connected = !!host.connectedAt;
            const isDefault = defaultAgentHostId != null && host.id === defaultAgentHostId;
            const lastSeen = host.lastSeenAt ? new Date(host.lastSeenAt).toLocaleString() : '—';
            return (
              <div
                key={`host-${host.id}`}
                className="card"
                role="button"
                tabIndex={0}
                onClick={() => setSelectedHost(host)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedHost(host); } }}
                style={{ ...cardStyle, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}>{host.name}</span>
                  <TypePill kind="host" />
                  {isDefault && (
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6, background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)' }}>Default</span>
                  )}
                  <span className={connected ? 'badge-green' : ''} style={!connected ? { background: 'var(--bg-elevated)', color: 'var(--muted)', padding: '2px 8px', borderRadius: 9999, fontSize: 11 } : {}}>
                    {connected ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{host.slug ?? host.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Last seen {lastSeen}</div>
                <div style={{ marginTop: 4 }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedHost(host); }} style={btnPrimary}>Open</button>
                </div>
              </div>
            );
          })}

          {/* Cloud agents */}
          {cloudAgents.map((a) => (
            <div key={`cloud-${a.id}`} className="card" style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}>{a.name}</span>
                <TypePill kind="cloud" />
                {a.published
                  ? <span className="badge-green">PUBLISHED</span>
                  : <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: 'var(--bg-elevated)', color: 'var(--muted)' }}>DRAFT</span>}
              </div>
              {a.title && a.title !== a.name && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.title}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                <span style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--surface-coral-soft)', color: 'var(--accent)' }}>
                  {RUNTIME_LABELS[a.runtime_support ?? 'cloud']}
                  {a.runtime_support === 'both' && a.preferred_runtime ? ` · prefers ${a.preferred_runtime}` : ''}
                </span>
                <span style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--bg-elevated)', color: 'var(--text-strong)' }}>{priceLabel(a)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {a.published
                  ? <button type="button" style={btnSubtle} onClick={() => unpublish(a)}>Unpublish</button>
                  : <button type="button" style={btnPrimary} onClick={() => openPublish(a)}>Publish</button>}
                {a.published && <button type="button" style={btnSubtle} onClick={() => openPublish(a)}>Edit price</button>}
                <button type="button" style={btnSubtle} onClick={() => openEdit(a)}>Edit</button>
                <button type="button" style={{ ...btnSubtle, color: 'var(--error-text)' }} onClick={() => removeCloud(a)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fleet mesh visualization */}
      {hosts.length > 1 && (
        <div style={{ marginTop: 36 }}>
          <FleetMeshContent agentHosts={hosts} />
        </div>
      )}

      {/* Remote agentHost slide-out */}
      {selectedHost && (
        <AgentHostSlideOutPanel
          agentHost={selectedHost}
          open={!!selectedHost}
          onClose={() => setSelectedHost(null)}
          tenantId={tenantId ?? undefined}
          defaultAgentHostId={defaultAgentHostId}
          onSetDefaultAgentHost={tenantId != null ? handleSetDefaultAgentHost : undefined}
          onDeleted={(id) => {
            setHosts((prev) => prev.filter((h) => h.id !== id));
            setDefaultAgentHostId((d) => (d === id ? null : d));
          }}
        />
      )}

      {/* Unified Add / Edit agent dialog */}
      {dialogOpen && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeDialog()}>
          <div className="card" style={{ maxWidth: 480, width: '100%', padding: 28, maxHeight: '88vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            {newHost ? (
              /* Remote registration success → show the one-time API key */
              <>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 4 }}>Remote agent registered</h3>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Copy the API key and add it to your remote agent’s environment. It won’t be shown again.</p>
                <label style={labelStyle}>API Key</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input type="password" readOnly value={newHost.apiKey} style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                  <button type="button" onClick={copyApiKey} style={btnPrimary}>{apiKeyCopied ? 'Copied!' : 'Copy'}</button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={closeDialog} style={btnPrimary}>Done</button>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 16 }}>{dialogTitle}</h3>

                {/* Type toggle — hidden when editing an existing cloud agent */}
                {!form.id && (
                  <div style={{ display: 'flex', gap: 0, marginBottom: 18, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    {(['cloud', 'host'] as AgentKind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => { setCreateKind(k); setError(''); }}
                        style={{
                          flex: 1, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                          background: createKind === k ? 'var(--accent)' : 'transparent',
                          color: createKind === k ? '#fff' : 'var(--text-strong)',
                        }}
                      >
                        {k === 'cloud' ? 'Cloud agent' : 'Remote (self-hosted)'}
                      </button>
                    ))}
                  </div>
                )}

                {createKind === 'host' ? (
                  /* Remote registration form */
                  <form onSubmit={registerHost}>
                    <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                      Give your remote agent (a self-hosted BuilderForce Agents instance) a name. You’ll get an API key to paste into its config.
                    </p>
                    <div style={{ marginBottom: 16 }}>
                      <label style={labelStyle}>Name</label>
                      <input
                        style={inputStyle}
                        value={registerName}
                        onChange={(e) => setRegisterName(e.target.value)}
                        placeholder="e.g. openclaw-bridge-node"
                        autoFocus
                      />
                    </div>
                    {error && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--error-text)' }}>{error}</div>}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" onClick={closeDialog} style={{ ...btnSubtle, background: 'none', border: 'none' }}>Cancel</button>
                      <button type="submit" disabled={registering || !registerName.trim()} style={btnPrimary}>
                        {registering ? 'Registering…' : 'Register'}
                      </button>
                    </div>
                  </form>
                ) : (
                  /* Cloud agent form */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={labelStyle}>Name</label>
                      <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Release Notes Writer" autoFocus />
                    </div>
                    <div>
                      <label style={labelStyle}>Title</label>
                      <input style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Short tagline" />
                    </div>
                    <div>
                      <label style={labelStyle}>Description</label>
                      <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="What does this agent do?" />
                    </div>
                    <div>
                      <label style={labelStyle}>Skills (comma-separated)</label>
                      <input style={inputStyle} value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} placeholder="code-review, summarization" />
                    </div>
                    <div>
                      <label style={labelStyle}>Runtime support</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {(Object.keys(RUNTIME_LABELS) as AgentRuntimeSupport[]).map((rs) => (
                          <label key={rs} style={{ fontSize: 13, color: 'var(--text-strong)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="radio" name="runtimeSupport" checked={form.runtimeSupport === rs} onChange={() => setForm({ ...form, runtimeSupport: rs })} />
                            {RUNTIME_LABELS[rs]}
                          </label>
                        ))}
                      </div>
                    </div>
                    {form.runtimeSupport === 'both' && (
                      <div>
                        <label style={labelStyle}>Best experience on</label>
                        <select style={inputStyle} value={form.preferredRuntime} onChange={(e) => setForm({ ...form, preferredRuntime: e.target.value as 'cloud' | 'host' })}>
                          <option value="cloud">Cloud</option>
                          <option value="host">Remote (agentHost)</option>
                        </select>
                      </div>
                    )}
                    <div>
                      <label style={labelStyle}>Base model (optional)</label>
                      <input style={inputStyle} value={form.baseModel} onChange={(e) => setForm({ ...form, baseModel: e.target.value })} placeholder="builderforce.ai default" />
                    </div>
                    {error && <div style={{ fontSize: 13, color: 'var(--error-text)' }}>{error}</div>}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" onClick={closeDialog} style={{ ...btnSubtle, background: 'none', border: 'none' }}>Cancel</button>
                      <button type="button" onClick={saveCloud} disabled={saving || !form.name.trim()} style={btnPrimary}>
                        {saving ? 'Saving…' : form.id ? 'Save' : 'Create'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Publish (set price) modal */}
      {publishTarget && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setPublishTarget(null)}>
          <div className="card" style={{ maxWidth: 420, width: '100%', padding: 28 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 4 }}>Publish to marketplace</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Set a price for <strong>{publishTarget.name}</strong>. Use 0 to list it for free.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Pricing model</label>
                <select style={inputStyle} value={pricingModel} onChange={(e) => setPricingModel(e.target.value as AgentPricingModel)}>
                  <option value="flat_fee">Flat fee</option>
                  <option value="consumption">Consumption (per unit)</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Price (USD)</label>
                <input style={inputStyle} type="number" min="0" step="0.01" value={priceDollars} onChange={(e) => setPriceDollars(e.target.value)} />
              </div>
              {pricingModel === 'consumption' && (
                <div>
                  <label style={labelStyle}>Per unit</label>
                  <input style={inputStyle} value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} placeholder="request, 1k tokens, task…" />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setPublishTarget(null)} style={{ ...btnSubtle, background: 'none', border: 'none' }}>Cancel</button>
                <button type="button" onClick={confirmPublish} style={btnPrimary}>{publishTarget.published ? 'Save price' : 'Publish'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <UpgradeModal error={planError} onClose={() => setPlanError(null)} />
    </section>
  );
}
