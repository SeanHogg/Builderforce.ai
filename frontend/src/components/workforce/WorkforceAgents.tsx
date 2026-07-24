'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBrainDataRefresh } from '@/lib/brain/useBrainDataRefresh';
import {
  agentHosts,
  tenantDefaultAgentHost,
  artifactAssignments,
  vscodeConnections,
  isVscodeConnectionOnline,
  type AgentHost,
  type AgentHostRegistration,
  type AgentManifest,
  type VscodeConnection,
} from '@/lib/builderforceApi';
import { useTranslations } from 'next-intl';
import {
  listMyAgents,
  listPurchasedAgents,
  createCloudAgent,
  updateAgent,
  deleteAgent,
  unhireAgent,
} from '@/lib/api';
import {
  listTenantMembers,
  removeTenantMember,
  updateMemberRole,
  listInvitations,
  revokeInvitation,
  type TenantMember,
  type PendingInvitation,
} from '@/lib/auth';
import { RoleGate } from '@/components/RoleGate';
import { ROLE_LABEL, usePermission, type TenantRole } from '@/lib/rbac';
import type { PublishedAgent } from '@/lib/types';
import { AgentHostSlideOutPanel } from '@/components/AgentHostSlideOutPanel';
import { FleetMeshContent } from '@/components/FleetMeshContent';
import { UpgradeModal } from '@/components/UpgradeModal';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useConfirm } from '@/components/ConfirmProvider';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { InviteTeamMembers } from '@/components/InviteTeamMembers';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';
import { CloudAgentSlideOutPanel, type CloudAgentPanelTab } from './CloudAgentSlideOutPanel';
import { ConfiguredQuickstartPopover } from './ConfiguredQuickstartPopover';
import { AgentCard } from './AgentCard';
import { AgentManifestInline } from './AgentManifestSection';
import { MemberCard, PendingInviteCard, RoleSelect } from './MemberCard';
import { WorkforceMetricsProvider } from './WorkforceMetricsContext';
import { MemberConsolidationPanel } from '@/components/contributors/MemberConsolidationPanel';
import { AgentOwnerActions } from './AgentOwnerActions';
import { AgentTypePill } from '@/components/AgentTypePill';
import { BuiltinKindBadge } from '@/components/BuiltinKindBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { formatAgentPrice } from '@/lib/agentPresentation';
import { isAgentOwner } from '@/lib/agentPermissions';
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
 * Workforce → the unified directory of everyone in the workspace: human members,
 * pending invites, the tenant's cloud agents, hired marketplace agents, and
 * registered remote agentHosts — all in one mixed grid where a type pill
 * (Human / Pending / Agent / Remote) designates each card. Humans and agents are
 * one workforce, so they share the same card shell.
 *
 * Two add actions live in the header: "Invite" (a person, by email) and the
 * "Add agent" split button (Cloud agent or remote registration). Managing a
 * cloud agent — edit, capabilities, pricing — happens in a right-side slide-out.
 */

type AgentKind = 'cloud' | 'host';

// "Add agent" split button: primary action + caret that opens the configured quickstart.
const splitMain: React.CSSProperties = { padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderTopLeftRadius: 8, borderBottomLeftRadius: 8, cursor: 'pointer' };
const splitCaret: React.CSSProperties = { padding: '8px 10px', fontSize: 11, fontWeight: 700, background: 'var(--accent)', color: '#fff', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.25)', borderTopRightRadius: 8, borderBottomRightRadius: 8, cursor: 'pointer', lineHeight: 1 };
// "Invite" (a person) — secondary to the coral "+ Agent" split button.
const inviteBtn: React.CSSProperties = { padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' };

// Host (remote agentHost) card chrome — cloud/purchased agents render via <AgentCard>.
const cardStyle: React.CSSProperties = {
  padding: 16, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative',
};

export function WorkforceAgents({ tenantId }: { tenantId?: number }) {
  const { tenant, tenantToken } = useAuth();
  const confirm = useConfirm();
  const tWf = useTranslations('workforce');
  const tAdd = useTranslations('workforceAddAgent');
  const tc = useTranslations('common');

  // --- "Connect a new agent" quickstart popover (caret on the split button) -
  const [quickstartOpen, setQuickstartOpen] = useState(false);

  // Card | List view mode (session-only) — same shared toggle as every other
  // collection page. Defaults to the card grid.
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  // --- Consolidate people (relocated from the Contributors tab) ------------
  // Managers can checkbox-select human members in list view and merge their
  // duplicate activity profiles in one pass.
  const canConsolidate = usePermission('members.manageRoles').allowed;
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [consolidateOpen, setConsolidateOpen] = useState(false);
  const toggleMemberSelected = useCallback((id: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // --- Remote agentHosts ---------------------------------------------------
  const [hosts, setHosts] = useState<AgentHost[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [defaultAgentHostId, setDefaultAgentHostId] = useState<number | null>(null);
  const [selectedHost, setSelectedHost] = useState<AgentHost | null>(null);

  // --- VS Code editor connections (mig 0202) -------------------------------
  // A per-user editor runtime that appears as a presence card in the workforce
  // grid (like a remote host, but read-only — it has no management panel).
  const [vscodeConns, setVscodeConns] = useState<VscodeConnection[]>([]);

  // --- Cloud agents --------------------------------------------------------
  const [cloudAgents, setCloudAgents] = useState<PublishedAgent[]>([]);
  const [loadingCloud, setLoadingCloud] = useState(true);
  // Per-agent assigned-capability manifests, keyed by agent ref (= PublishedAgent.id).
  // One cached fetch for the whole grid (no per-card N+1); refreshed when an agent's
  // capabilities are edited in the slide-out, or an agent is created/deleted.
  const [agentManifests, setAgentManifests] = useState<Record<string, AgentManifest>>({});
  // Agents acquired from the marketplace (distinct from the tenant's own).
  const [purchasedAgents, setPurchasedAgents] = useState<PublishedAgent[]>([]);

  // --- People: human members + pending invites -----------------------------
  const [members, setMembers] = useState<TenantMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvitation[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<TenantMember | null>(null);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);

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
      setError(e instanceof Error ? e.message : tWf('errLoadRemote'));
    } finally {
      setLoadingHosts(false);
    }
  }, []);

  const loadCloud = useCallback((): Promise<PublishedAgent[]> => {
    setLoadingCloud(true);
    return listMyAgents()
      .then((list) => { setCloudAgents(list); return list; })
      .catch((e) => { setError(e instanceof Error ? e.message : tWf('errLoadCloud')); return [] as PublishedAgent[]; })
      .finally(() => setLoadingCloud(false));
  }, []);

  const loadPurchased = useCallback(() => {
    return listPurchasedAgents().then(setPurchasedAgents).catch(() => setPurchasedAgents([]));
  }, []);

  const loadVscode = useCallback(() => {
    return vscodeConnections.list().then(setVscodeConns).catch(() => setVscodeConns([]));
  }, []);

  const loadManifests = useCallback(() => {
    return artifactAssignments.agentManifests().then(setAgentManifests).catch(() => setAgentManifests({}));
  }, []);

  // People (members + pending invites) require the tenant token; both share one
  // loading flag since they render in the same section of the grid.
  const loadPeople = useCallback(async () => {
    if (!tenant || !tenantToken) { setLoadingPeople(false); return; }
    setLoadingPeople(true);
    try {
      const [memberList, inviteList] = await Promise.all([
        listTenantMembers(tenantToken, String(tenant.id)),
        listInvitations(tenantToken, String(tenant.id)).catch(() => [] as PendingInvitation[]),
      ]);
      setMembers(memberList);
      setPendingInvites(inviteList);
    } catch (e) {
      if (isPlanLimitError(e)) setPlanError(e);
      else setError(e instanceof Error ? e.message : tWf('errLoadMembers'));
    } finally {
      setLoadingPeople(false);
    }
  }, [tenant, tenantToken]);

  useEffect(() => { loadHosts(); loadCloud(); loadPurchased(); loadPeople(); loadManifests(); loadVscode(); }, [loadHosts, loadCloud, loadPurchased, loadPeople, loadManifests, loadVscode]);

  // Refetch the agent rosters when the Brain creates/updates/deletes a cloud
  // agent or hires a marketplace agent, so the grid stays live (no manual reload).
  const reloadAgents = useCallback(() => { void loadCloud(); void loadPurchased(); }, [loadCloud, loadPurchased]);
  useBrainDataRefresh(['cloud_agents', 'agents_published'], reloadAgents);

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
    if (!form.name.trim()) { setError(tWf('errNameRequired')); return; }
    setSaving(true); setError('');
    try {
      await createCloudAgent(cloudAgentFormToInput(form));
      closeDialog(); loadCloud();
    } catch (e) {
      setError(e instanceof Error ? e.message : tWf('errSaveFailed'));
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
        setError(e instanceof Error ? e.message : tWf('errRegisterFailed'));
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
    if (!(await confirm(tc('deleteAgentPermanentConfirm', { name: a.name })))) return;
    try {
      await deleteAgent(a.id);
      loadCloud();
    } catch (e) {
      setError(e instanceof Error ? e.message : tWf('errDeleteFailed'));
    }
  };

  // Release a hired (purchased) agent — these are agents the tenant did NOT
  // create, so the action is "unhire", not "delete".
  const [unhiringId, setUnhiringId] = useState<string | null>(null);
  const unhire = async (agentId: string) => {
    setUnhiringId(agentId);
    try {
      await unhireAgent(agentId);
      await loadPurchased();
    } catch (e) {
      setError(e instanceof Error ? e.message : tWf('errUnhireFailed'));
    } finally {
      setUnhiringId(null);
    }
  };

  // --- People actions ------------------------------------------------------
  const handleRemoveMember = async (member: TenantMember) => {
    if (!tenant || !tenantToken) return;
    setRemovingMemberId(member.id);
    try {
      await removeTenantMember(tenantToken, String(tenant.id), member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (e) {
      if (isPlanLimitError(e)) setPlanError(e);
      else setError(e instanceof Error ? e.message : tWf('errRemoveMember'));
    } finally {
      setRemovingMemberId(null);
      setConfirmRemove(null);
    }
  };

  const handleChangeRole = async (member: TenantMember, role: string) => {
    if (!tenant || !tenantToken || role === member.role) return;
    setChangingRoleId(member.id);
    try {
      await updateMemberRole(tenantToken, String(tenant.id), member.id, role);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role } : m)));
    } catch (e) {
      if (isPlanLimitError(e)) setPlanError(e);
      else setError(e instanceof Error ? e.message : tWf('errChangeRole'));
    } finally {
      setChangingRoleId(null);
    }
  };

  const handleRevokeInvite = async (invite: PendingInvitation) => {
    if (!tenant || !tenantToken) return;
    setRevokingInviteId(invite.id);
    try {
      await revokeInvitation(tenantToken, String(tenant.id), invite.id);
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : tWf('errRevokeInvite'));
    } finally {
      setRevokingInviteId(null);
    }
  };

  // A tenant can no longer hire its own agent (the API rejects it), but guard the
  // render too: never show an owned agent in the "purchased" list, or it appears
  // twice and the duplicate renders owner actions instead of Unhire. Match on both
  // ownership and presence in the owned list so a stale self-purchase can't slip through.
  const ownedIds = new Set(cloudAgents.map((a) => a.id));
  const visiblePurchased = purchasedAgents.filter(
    (a) => !ownedIds.has(a.id) && !isAgentOwner(a, tenant?.id),
  );

  const selectedMembers = members.filter((m) => selectedMemberIds.has(m.id));

  const loading = loadingHosts || loadingCloud || loadingPeople;
  const isEmpty = hosts.length === 0 && cloudAgents.length === 0 && visiblePurchased.length === 0
    && members.length === 0 && pendingInvites.length === 0;

  return (
   <WorkforceMetricsProvider>
    <section data-tour="demo-roster">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>{tWf('workforceTitle')}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {!loading && !isEmpty && <ViewToggle value={viewMode} onChange={setViewMode} />}
        {canConsolidate && viewMode === 'table' && (
          <button type="button" onClick={() => setConsolidateOpen(true)} style={inviteBtn}>
            {selectedMembers.length > 0 ? tWf('consolidateActionCount', { count: selectedMembers.length }) : tWf('consolidateAction')}
          </button>
        )}
        {tenant && tenantToken && (
          <RoleGate capability="members.invite">
            <button type="button" onClick={() => setInviteOpen(true)} style={inviteBtn}>{tWf('inviteAction')}</button>
          </RoleGate>
        )}
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <RoleGate capability="agents.create">
          <button type="button" onClick={() => openCreate('cloud')} style={splitMain}>{tWf('addAgentAction')}</button>
          </RoleGate>
          <button
            type="button"
            onClick={() => setQuickstartOpen((o) => !o)}
            style={splitCaret}
            aria-label={tWf('quickstartAria')}
            aria-haspopup="dialog"
            aria-expanded={quickstartOpen}
          >
            ▾
          </button>
          {quickstartOpen && (
            <ConfiguredQuickstartPopover
              workgroupName={tenant?.name ?? tWf('workgroupFallback')}
              workgroupSlug={tenant?.slug}
              tenantToken={tenantToken}
              onClose={() => setQuickstartOpen(false)}
            />
          )}
        </div>
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        {tWf('intro')}
      </p>

      {error && !dialogOpen && (
        <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--error-text)' }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: 24 }}>{tWf('loadingWorkforce')}</div>
      ) : isEmpty ? (
        <div className="empty-state" style={{ padding: 48 }}>
          <div className="empty-state-icon">📁</div>
          <div className="empty-state-title">{tWf('emptyTitle')}</div>
          <div className="empty-state-sub">{tWf('emptySub')}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <RoleGate capability="members.invite">
              <button type="button" onClick={() => setInviteOpen(true)} style={{ ...inviteBtn, padding: '10px 18px', fontSize: 14, borderRadius: 10 }}>
                {tWf('inviteTeammate')}
              </button>
            </RoleGate>
            <RoleGate capability="agents.create">
              <button type="button" onClick={() => openCreate('cloud')} style={{ ...btnPrimary, padding: '10px 18px', fontSize: 14, borderRadius: 10 }}>
                {tWf('addAgent')}
              </button>
            </RoleGate>
          </div>
        </div>
      ) : viewMode === 'card' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {/* People first — human members, then pending invites */}
          {members.map((m) => (
            <MemberCard
              key={`member-${m.id}`}
              member={m}
              onRemove={setConfirmRemove}
              onChangeRole={handleChangeRole}
              removing={removingMemberId === m.id}
              changingRole={changingRoleId === m.id}
            />
          ))}
          {pendingInvites.map((inv) => (
            <PendingInviteCard
              key={`invite-${inv.id}`}
              invite={inv}
              onRevoke={handleRevokeInvite}
              revoking={revokingInviteId === inv.id}
            />
          ))}

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
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6, background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)' }}>{tWf('defaultBadge')}</span>
                  )}
                  <StatusBadge variant={connected ? 'online' : 'offline'} />
                </div>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{host.slug ?? host.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tWf('hostLastSeen', { when: lastSeen })}</div>
                <div style={{ marginTop: 4 }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedHost(host); }} style={btnPrimary}>{tWf('open')}</button>
                </div>
              </div>
            );
          })}

          {/* VS Code editor connections — read-only presence cards (no mgmt panel) */}
          {vscodeConns.map((conn) => {
            const online = isVscodeConnectionOnline(conn);
            const lastSeen = conn.lastSeenAt ? new Date(conn.lastSeenAt).toLocaleString() : '—';
            return (
              <div key={`vscode-${conn.id}`} className="card" style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-strong)', flex: 1 }}>{conn.machineName}</span>
                  <AgentTypePill kind="vscode" />
                  <StatusBadge variant={online ? 'online' : 'offline'} />
                </div>
                {conn.extensionVersion && (
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{conn.extensionVersion}</div>
                )}
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tWf('vscode.lastSeen', { when: lastSeen })}</div>
              </div>
            );
          })}

          {/* Cloud agents the tenant owns — the card detects ownership from auth
              and renders the management actions. */}
          {cloudAgents.map((a) => (
            <AgentCard
              key={`cloud-${a.id}`}
              agent={a}
              manifest={agentManifests[a.id]}
              onOpenPanel={openAgentPanel}
              onUnpublish={unpublish}
              onDelete={deleteOwned}
            />
          ))}

          {/* Purchased (marketplace) agents — already hired, so the card offers
              Unhire (release from this workforce). */}
          {visiblePurchased.map((a) => (
            <AgentCard
              key={`purchased-${a.id}`}
              agent={a}
              manifest={agentManifests[a.id]}
              hired
              onUnhire={unhire}
              unhiring={unhiringId === a.id}
            />
          ))}
        </div>
      ) : (
        /* List (table) view — every collection (people + agents) flattened into
           one shared-chrome table. */
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                {canConsolidate && <th style={{ ...thStyle, width: 36 }} aria-label={tWf('selectToConsolidateAria')} />}
                <th style={thStyle}>{tWf('colName')}</th>
                <th style={thStyle}>{tWf('colType')}</th>
                <th style={thStyle}>{tWf('colStatus')}</th>
                <th style={thStyle}>{tWf('colRuntime')}</th>
                <th style={thStyle}>{tWf('colPrice')}</th>
                <th style={thStyle}>{tWf('colConfiguration')}</th>
                <th style={thStyle} aria-label={tWf('colActionsAria')} />
              </tr>
            </thead>
            <tbody>
              {/* People — human members */}
              {members.map((m) => (
                <tr key={`member-${m.id}`} style={trStyle}>
                  {canConsolidate && (
                    <td style={tdStyle}>
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.has(m.id)}
                        onChange={() => toggleMemberSelected(m.id)}
                        aria-label={tWf('selectMemberAria', { name: m.displayName ?? m.email })}
                      />
                    </td>
                  )}
                  <td style={tdStyle}>{m.displayName ?? m.username ?? m.email}</td>
                  <td style={tdStyle}><AgentTypePill kind="human" /></td>
                  <td style={tdMutedStyle}>{m.email}</td>
                  <td style={tdMutedStyle}>{ROLE_LABEL[m.role as TenantRole] ?? m.role}</td>
                  <td style={tdMutedStyle}>—</td>
                  <td style={tdStyle}>
                    <RoleSelect value={m.role} onChange={(role) => handleChangeRole(m, role)} busy={changingRoleId === m.id} compact />
                  </td>
                  <td style={tdStyle}>
                    <button type="button" style={btnSubtle} disabled={removingMemberId === m.id} onClick={() => setConfirmRemove(m)}>
                      {removingMemberId === m.id ? tWf('removing') : tWf('remove')}
                    </button>
                  </td>
                </tr>
              ))}

              {/* People — pending invites */}
              {pendingInvites.map((inv) => (
                <tr key={`invite-${inv.id}`} style={trStyle}>
                  {canConsolidate && <td style={tdStyle} />}
                  <td style={tdStyle}>{inv.email}</td>
                  <td style={tdStyle}><AgentTypePill kind="pending" /></td>
                  <td style={tdMutedStyle}>{tWf('invitedAs', { role: inv.role })}</td>
                  <td style={tdMutedStyle}>—</td>
                  <td style={tdMutedStyle}>—</td>
                  <td style={tdMutedStyle}>—</td>
                  <td style={tdStyle}>
                    <button type="button" style={btnSubtle} disabled={revokingInviteId === inv.id} onClick={() => handleRevokeInvite(inv)}>
                      {revokingInviteId === inv.id ? tWf('revoking') : tWf('revoke')}
                    </button>
                  </td>
                </tr>
              ))}

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
                    {canConsolidate && <td style={tdStyle} />}
                    <td style={tdStyle}>
                      {host.name}
                      {isDefault && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 6, background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)' }}>{tWf('defaultBadge')}</span>
                      )}
                    </td>
                    <td style={tdStyle}><AgentTypePill kind="host" /></td>
                    <td style={tdMutedStyle}>{connected ? tWf('statusOnline') : tWf('statusOffline')}</td>
                    <td style={tdMutedStyle}>{tWf('runtimeRemote')}</td>
                    <td style={tdMutedStyle}>—</td>
                    <td style={tdMutedStyle}>—</td>
                    <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => setSelectedHost(host)} style={btnSubtle}>{tWf('open')}</button>
                    </td>
                  </tr>
                );
              })}

              {/* VS Code editor connections */}
              {vscodeConns.map((conn) => {
                const online = isVscodeConnectionOnline(conn);
                return (
                  <tr key={`vscode-${conn.id}`} style={trStyle}>
                    {canConsolidate && <td style={tdStyle} />}
                    <td style={tdStyle}>{conn.machineName}</td>
                    <td style={tdStyle}><AgentTypePill kind="vscode" /></td>
                    <td style={tdMutedStyle}>{online ? tWf('vscode.online') : tWf('vscode.offline')}</td>
                    <td style={tdMutedStyle}>{tWf('vscode.runtime')}</td>
                    <td style={tdMutedStyle}>—</td>
                    <td style={tdMutedStyle}>{conn.extensionVersion ?? '—'}</td>
                    <td style={tdStyle} />
                  </tr>
                );
              })}

              {/* Cloud agents */}
              {cloudAgents.map((a) => (
                <tr key={`cloud-${a.id}`} style={trStyle}>
                  {canConsolidate && <td style={tdStyle} />}
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {a.name}
                      <BuiltinKindBadge kind={a.builtin_kind} />
                    </span>
                  </td>
                  <td style={tdStyle}><AgentTypePill kind="cloud" /></td>
                  <td style={tdMutedStyle}>{a.published ? tWf('statusPublished') : tWf('statusDraft')}</td>
                  <td style={tdMutedStyle}>{RUNTIME_LABELS[a.runtime_support ?? 'cloud']}</td>
                  <td style={tdMutedStyle}>{formatAgentPrice(a)}</td>
                  <td style={tdStyle}><AgentManifestInline agent={a} manifest={agentManifests[a.id]} /></td>
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

              {/* Purchased (marketplace) agents — not owned, so Unhire instead
                  of the owner action set. */}
              {visiblePurchased.map((a) => (
                <tr key={`purchased-${a.id}`} style={trStyle}>
                  {canConsolidate && <td style={tdStyle} />}
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {a.name}
                      <BuiltinKindBadge kind={a.builtin_kind} />
                    </span>
                  </td>
                  <td style={tdStyle}><AgentTypePill kind="marketplace" /></td>
                  <td style={tdMutedStyle}>—</td>
                  <td style={tdMutedStyle}>{RUNTIME_LABELS[a.runtime_support ?? 'cloud']}</td>
                  <td style={tdMutedStyle}>{formatAgentPrice(a)}</td>
                  <td style={tdStyle}><AgentManifestInline agent={a} manifest={agentManifests[a.id]} /></td>
                  <td style={tdStyle}>
                    <button type="button" style={btnSubtle} disabled={unhiringId === a.id} onClick={() => unhire(a.id)}>
                      {unhiringId === a.id ? tWf('unhiring') : tWf('unhire')}
                    </button>
                  </td>
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

      {/* Invite a teammate slide-out */}
      {tenant && tenantToken && (
        <SlideOutPanel open={inviteOpen} onClose={() => setInviteOpen(false)} title={tWf('inviteTeammate')}>
          <div style={{ padding: 20 }}>
            <InviteTeamMembers
              tenantId={String(tenant.id)}
              tenantToken={tenantToken}
              onInvited={() => { void loadPeople(); }}
              onPlanLimit={(err) => setPlanError(err)}
            />
          </div>
        </SlideOutPanel>
      )}

      {/* Confirm removing a human member */}
      <ConfirmDialog
        open={!!confirmRemove}
        message={
          confirmRemove
            ? tWf('removeMemberConfirm', { name: confirmRemove.displayName ?? confirmRemove.email })
            : ''
        }
        confirmLabel={tWf('remove')}
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => { if (confirmRemove) void handleRemoveMember(confirmRemove); }}
      />

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
          onClose={() => { setSelectedAgent(null); loadManifests(); }}
          onSaved={async () => {
            // Refetch AND re-sync the open panel's agent so its header (name,
            // DRAFT/PUBLISHED) reflects the just-saved/published values — without
            // this the panel keeps the stale prop and looks like nothing changed.
            // Capabilities are edited in this panel too, so refresh the manifests.
            const [list] = await Promise.all([loadCloud(), loadManifests()]);
            setSelectedAgent((cur) => (cur ? list.find((x) => x.id === cur.id) ?? cur : cur));
          }}
          onDeleted={() => { setSelectedAgent(null); loadCloud(); loadManifests(); }}
        />
      )}

      {/* Unified "Add agent" create dialog (cloud + remote) */}
      <SlideOutPanel
        open={dialogOpen}
        onClose={closeDialog}
        title={newHost ? tAdd('registeredTitle') : tAdd('title')}
        width="min(480px, 96vw)"
      >
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {newHost ? (
            /* Remote registration success → show the one-time API key */
            <>
              <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{tAdd('apiKeyHint')}</p>
              <div>
                <label style={labelStyle}>{tAdd('apiKeyLabel')}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="password" readOnly value={newHost.apiKey} style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                  <button type="button" onClick={copyApiKey} style={btnPrimary}>{apiKeyCopied ? tAdd('copied') : tAdd('copy')}</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={closeDialog} style={btnPrimary}>{tAdd('done')}</button>
              </div>
            </>
          ) : (
            <>
              {/* Type toggle */}
              <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
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
                    {k === 'cloud' ? tAdd('tabCloud') : tAdd('tabRemote')}
                  </button>
                ))}
              </div>

              {createKind === 'host' ? (
                /* Remote registration form */
                <form onSubmit={registerHost}>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                    {tAdd('remoteIntro')}
                  </p>
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>{tAdd('nameLabel')}</label>
                    <input
                      style={inputStyle}
                      value={registerName}
                      onChange={(e) => setRegisterName(e.target.value)}
                      placeholder={tAdd('namePlaceholder')}
                      autoFocus
                    />
                  </div>
                  {error && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--error-text)' }}>{error}</div>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={closeDialog} style={{ ...btnSubtle, background: 'none', border: 'none' }}>{tc('cancel')}</button>
                    <button type="submit" disabled={registering || !registerName.trim()} style={btnPrimary}>
                      {registering ? tAdd('registering') : tAdd('register')}
                    </button>
                  </div>
                </form>
              ) : (
                /* Cloud agent create form */
                <>
                  <CloudAgentFormFields form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} autoFocus />
                  {error && <div style={{ fontSize: 13, color: 'var(--error-text)', marginTop: 12 }}>{error}</div>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                    <button type="button" onClick={closeDialog} style={{ ...btnSubtle, background: 'none', border: 'none' }}>{tc('cancel')}</button>
                    <button type="button" onClick={createCloud} disabled={saving || !form.name.trim()} style={btnPrimary}>
                      {saving ? tc('saving') : tAdd('create')}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </SlideOutPanel>

      {/* Consolidate selected people — relocated home of contributor merge */}
      <MemberConsolidationPanel
        open={consolidateOpen}
        onClose={() => setConsolidateOpen(false)}
        members={selectedMembers}
        onMerged={() => { setSelectedMemberIds(new Set()); void loadPeople(); }}
      />

      <UpgradeModal error={planError} onClose={() => setPlanError(null)} />
    </section>
   </WorkforceMetricsProvider>
  );
}
