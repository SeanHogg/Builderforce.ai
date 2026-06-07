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
  listPurchasedAgents,
  createCloudAgent,
  updateAgent,
  deleteAgent,
} from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';
import { AgentHostSlideOutPanel } from '@/components/AgentHostSlideOutPanel';
import { FleetMeshContent } from '@/components/FleetMeshContent';
import { UpgradeModal } from '@/components/UpgradeModal';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';
import { CloudAgentSlideOutPanel, type CloudAgentPanelTab } from './CloudAgentSlideOutPanel';
import { ConfiguredQuickstartPopover } from './ConfiguredQuickstartPopover';
import { AgentCard } from './AgentCard';
import { AgentOwnerActions } from './AgentOwnerActions';
import { AgentTypePill } from '@/components/AgentTypePill';
import { StatusBadge } from '@/components/StatusBadge';
import { formatAgentPrice } from '@/lib/agentPresentation';
import { useAuth } from '@/lib/AuthContext';
import {
  CloudAgentFormFields,
  cloudAgentFormToInput,
  EMPTY_CLOUD_AGENT_FORM,
  RUNTIME_LABELS,
  inputStyle,
  labelStyle,
  btnPrimary,
  btnSubtle,
  type CloudAgentFormState,
} from './CloudAgentFormFields';

/**
 * Workforce → unified agent directory. Lists the tenant's cloud agents AND its
 * registered remote agentHosts in a single grid; a "Type" pill on each card
 * designates which is which. The "Add agent" dialog covers creation for both
 * (a Cloud/Remote toggle). Managing an existing cloud agent — edit, capabilities
 * (skills/personas), pricing — happens in a right-side slide-out panel, matching
 * the remote agentHost panel.
 */

type AgentKind = 'cloud' | 'host';

// "Add agent" split button: primary action + caret that opens the configured quickstart.
const splitMain: React.CSSProperties = { padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderTopLeftRadius: 8, borderBottomLeftRadius: 8, cursor: 'pointer' };
const splitCaret: React.CSSProperties = { padding: '8px 10px', fontSize: 11, fontWeight: 700, background: 'var(--accent)', color: '#fff', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.25)', borderTopRightRadius: 8, borderBottomRightRadius: 8, cursor: 'pointer', lineHeight: 1 };

// Host (remote agentHost) card chrome — cloud/purchased agents render via <AgentCard>.
const cardStyle: React.CSSProperties = {
  padding: 16, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative',
};

export function WorkforceAgents({ tenantId }: { tenantId?: number }) {
  const { tenant, tenantToken } = useAuth();

  // --- "Connect a new agent" quickstart popover (caret on the split button) -
  const [quickstartOpen, setQuickstartOpen] = useState(false);

  // Card | List view mode (session-only) — same shared toggle as every other
  // collection page. Defaults to the card grid.
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  // --- Remote agentHosts ---------------------------------------------------
  const [hosts, setHosts] = useState<AgentHost[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [defaultAgentHostId, setDefaultAgentHostId] = useState<number | null>(null);
  const [selectedHost, setSelectedHost] = useState<AgentHost | null>(null);

  // --- Cloud agents --------------------------------------------------------
  const [cloudAgents, setCloudAgents] = useState<PublishedAgent[]>([]);
  const [loadingCloud, setLoadingCloud] = useState(true);
  // Agents acquired from the marketplace (distinct from the tenant's own).
  const [purchasedAgents, setPurchasedAgents] = useState<PublishedAgent[]>([]);

  const [error, setError] = useState('');
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);

  // --- "Add agent" create dialog -------------------------------------------
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createKind, setCreateKind] = useState<AgentKind>('cloud');
  // cloud sub-state
  const [form, setForm] = useState<CloudAgentFormState>(EMPTY_CLOUD_AGENT_FORM);
  const [saving, setSaving] = useState(false);
  // remote sub-state
  const [registerName, setRegisterName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [newHost, setNewHost] = useState<AgentHostRegistration | null>(null);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

  // --- Cloud agent management slide-out ------------------------------------
  const [selectedAgent, setSelectedAgent] = useState<PublishedAgent | null>(null);
  const [agentPanelTab, setAgentPanelTab] = useState<CloudAgentPanelTab>('details');

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

  const loadCloud = useCallback((): Promise<PublishedAgent[]> => {
    setLoadingCloud(true);
    return listMyAgents()
      .then((list) => { setCloudAgents(list); return list; })
      .catch((e) => { setError(e instanceof Error ? e.message : 'Failed to load cloud agents'); return [] as PublishedAgent[]; })
      .finally(() => setLoadingCloud(false));
  }, []);

  const loadPurchased = useCallback(() => {
    return listPurchasedAgents().then(setPurchasedAgents).catch(() => setPurchasedAgents([]));
  }, []);

  useEffect(() => { loadHosts(); loadCloud(); loadPurchased(); }, [loadHosts, loadCloud, loadPurchased]);

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

  // --- Create dialog open/close --------------------------------------------
  const openCreate = (kind: AgentKind) => {
    setCreateKind(kind);
    setForm(EMPTY_CLOUD_AGENT_FORM);
    setRegisterName('');
    setNewHost(null);
    setApiKeyCopied(false);
    setError('');
    setDialogOpen(true);
  };
  const closeDialog = () => {
    setDialogOpen(false);
    setForm(EMPTY_CLOUD_AGENT_FORM);
    setRegisterName('');
    setNewHost(null);
    setApiKeyCopied(false);
    setError('');
  };

  // --- Open the management panel (edit / capabilities / pricing) ------------
  const openAgentPanel = (a: PublishedAgent, tab: CloudAgentPanelTab) => {
    setAgentPanelTab(tab);
    setSelectedAgent(a);
  };

  // --- Cloud create --------------------------------------------------------
  const createCloud = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      await createCloudAgent(cloudAgentFormToInput(form));
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

  // --- Quick card actions --------------------------------------------------
  const unpublish = async (a: PublishedAgent) => { await updateAgent(a.id, { published: false }); loadCloud(); };
  const deleteOwned = async (a: PublishedAgent) => {
    if (!confirm(`Delete agent "${a.name}"? This permanently removes it and its per-agent skills/personas. This cannot be undone.`)) return;
    try {
      await deleteAgent(a.id);
      loadCloud();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const loading = loadingHosts || loadingCloud;
  const isEmpty = hosts.length === 0 && cloudAgents.length === 0 && purchasedAgents.length === 0;

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>Agents</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {!loading && !isEmpty && <ViewToggle value={viewMode} onChange={setViewMode} />}
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <button type="button" onClick={() => openCreate('cloud')} style={splitMain}>+ Agent</button>
          <button
            type="button"
            onClick={() => setQuickstartOpen((o) => !o)}
            style={splitCaret}
            aria-label="Connect a new agent with the quickstart"
            aria-haspopup="dialog"
            aria-expanded={quickstartOpen}
          >
            ▾
          </button>
          {quickstartOpen && (
            <ConfiguredQuickstartPopover
              workgroupName={tenant?.name ?? 'your workgroup'}
              workgroupSlug={tenant?.slug}
              tenantToken={tenantToken}
              onClose={() => setQuickstartOpen(false)}
            />
          )}
        </div>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        Your cloud agents and registered remote agents (self-hosted BuilderForce Agents instances) in one place.
        Publish a cloud agent to the marketplace to earn revenue.
      </p>

      {error && !dialogOpen && (
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
      ) : viewMode === 'card' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {/* Remote agentHosts */}
          {hosts.map((host) => {
            const connected = !!host.online;
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
                  <AgentTypePill kind="host" />
                  {isDefault && (
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6, background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)' }}>Default</span>
                  )}
                  <StatusBadge variant={connected ? 'online' : 'offline'} />
                </div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{host.slug ?? host.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Last seen {lastSeen}</div>
                <div style={{ marginTop: 4 }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedHost(host); }} style={btnPrimary}>Open</button>
                </div>
              </div>
            );
          })}

          {/* Cloud agents the tenant owns */}
          {cloudAgents.map((a) => (
            <AgentCard
              key={`cloud-${a.id}`}
              agent={a}
              variant="owned"
              onOpenPanel={openAgentPanel}
              onUnpublish={unpublish}
              onDelete={deleteOwned}
            />
          ))}

          {/* Purchased (marketplace) agents — read-only, no owner actions. */}
          {purchasedAgents.map((a) => (
            <AgentCard key={`purchased-${a.id}`} agent={a} variant="purchased" />
          ))}
        </div>
      ) : (
        /* List (table) view — the same three collections as the card grid,
           flattened into one shared-chrome table. */
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Runtime</th>
                <th style={thStyle}>Price</th>
                <th style={thStyle} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {/* Remote agentHosts */}
              {hosts.map((host) => {
                const connected = !!host.online;
                const isDefault = defaultAgentHostId != null && host.id === defaultAgentHostId;
                return (
                  <tr
                    key={`host-${host.id}`}
                    style={{ ...trStyle, cursor: 'pointer' }}
                    onClick={() => setSelectedHost(host)}
                  >
                    <td style={tdStyle}>
                      {host.name}
                      {isDefault && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6, background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)' }}>Default</span>
                      )}
                    </td>
                    <td style={tdStyle}><AgentTypePill kind="host" /></td>
                    <td style={tdMutedStyle}>{connected ? 'Online' : 'Offline'}</td>
                    <td style={tdMutedStyle}>Remote</td>
                    <td style={tdMutedStyle}>—</td>
                    <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => setSelectedHost(host)} style={btnSubtle}>Open</button>
                    </td>
                  </tr>
                );
              })}

              {/* Cloud agents */}
              {cloudAgents.map((a) => (
                <tr key={`cloud-${a.id}`} style={trStyle}>
                  <td style={tdStyle}>{a.name}</td>
                  <td style={tdStyle}><AgentTypePill kind="cloud" /></td>
                  <td style={tdMutedStyle}>{a.published ? 'Published' : 'Draft'}</td>
                  <td style={tdMutedStyle}>{RUNTIME_LABELS[a.runtime_support ?? 'cloud']}</td>
                  <td style={tdMutedStyle}>{formatAgentPrice(a)}</td>
                  <td style={tdStyle}>
                    <AgentOwnerActions
                      agent={a}
                      onOpenPanel={openAgentPanel}
                      onUnpublish={unpublish}
                      onDelete={deleteOwned}
                      includeEditPrice={false}
                    />
                  </td>
                </tr>
              ))}

              {/* Purchased (marketplace) agents — no owner actions. */}
              {purchasedAgents.map((a) => (
                <tr key={`purchased-${a.id}`} style={trStyle}>
                  <td style={tdStyle}>{a.name}</td>
                  <td style={tdStyle}><AgentTypePill kind="marketplace" /></td>
                  <td style={tdMutedStyle}>—</td>
                  <td style={tdMutedStyle}>{RUNTIME_LABELS[a.runtime_support ?? 'cloud']}</td>
                  <td style={tdMutedStyle}>{formatAgentPrice(a)}</td>
                  <td style={tdStyle} />
                </tr>
              ))}
            </tbody>
          </table>
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

      {/* Cloud agent management slide-out */}
      {selectedAgent && (
        <CloudAgentSlideOutPanel
          agent={selectedAgent}
          open={!!selectedAgent}
          initialTab={agentPanelTab}
          tenantId={tenantId}
          onClose={() => setSelectedAgent(null)}
          onSaved={async () => {
            // Refetch AND re-sync the open panel's agent so its header (name,
            // DRAFT/PUBLISHED) reflects the just-saved/published values — without
            // this the panel keeps the stale prop and looks like nothing changed.
            const list = await loadCloud();
            setSelectedAgent((cur) => (cur ? list.find((x) => x.id === cur.id) ?? cur : cur));
          }}
          onDeleted={() => { setSelectedAgent(null); loadCloud(); }}
        />
      )}

      {/* Unified "Add agent" create dialog (cloud + remote) */}
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
                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 16 }}>Add agent</h3>

                {/* Type toggle */}
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
                  /* Cloud agent create form */
                  <>
                    <CloudAgentFormFields form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} autoFocus />
                    {error && <div style={{ fontSize: 13, color: 'var(--error-text)', marginTop: 12 }}>{error}</div>}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                      <button type="button" onClick={closeDialog} style={{ ...btnSubtle, background: 'none', border: 'none' }}>Cancel</button>
                      <button type="button" onClick={createCloud} disabled={saving || !form.name.trim()} style={btnPrimary}>
                        {saving ? 'Saving…' : 'Create'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <UpgradeModal error={planError} onClose={() => setPlanError(null)} />
    </section>
  );
}
