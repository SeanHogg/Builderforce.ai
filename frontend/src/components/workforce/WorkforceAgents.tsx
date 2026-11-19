import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
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
import { membersApi, type TenantMember, type PendingInvitation } from '@/lib/auth/members';
import { RoleGate } from '@/components/RoleGate';
import { SplitButton } from '@/components/ui/SplitButton';
import { usePermission } from '@/lib/rbac';
import { useRoleText } from '@/lib/useRoleText';
import type { PublishedAgent } from '@/lib/types';
import { AgentHostSlideOutPanel } from '@/components/AgentHostSlideOutPanel';
import { FleetMeshContent } from '@/components/FleetMeshContent';
import { UpgradeModal } from '@/components/UpgradeModal';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useConfirm } from '@/components/ConfirmProvider';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { InviteTeamMembers } from '@/components/InviteTeamMembers';
import { Collection } from '@/components/collection/Collection';
import { useLocalSource } from '@/components/collection/sources';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
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
import { ActiveRunsPanel } from '@/components/ActiveRunsPanel';
import { ManagedAgentHostPanel } from './ManagedAgentHostPanel';
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
import { useRuntimeSurfaceRefusal } from './RuntimeSurfaceSelect';
import { useFormat } from "@/i18n/useFormat";
import { faultText } from '@/lib/apiClient';
import { type AgentKind, inviteBtn, cardStyle } from './workforceAgentChrome';
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

export function WorkforceAgents({ tenantId }: { tenantId?: number }) {
  const fmt = useFormat();
  const { tenant, tenantToken } = useAuth();
  const confirm = useConfirm();
  const tWf = useTranslations('workforce');
  const roleText = useRoleText();
  const tAdd = useTranslations('workforceAddAgent');
  const tc = useTranslations('common');

  // Card | List view mode (session-only) — same shared toggle as every other
  // collection page. Defaults to the card grid.
  const [dirSearch, setDirSearch] = useState('');

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
  // The same cached readiness/entitlement the surface picker disables on, so the
  // create cannot save a combination the option already refused.
  const surfaceRefusal = useRuntimeSurfaceRefusal(form.runtimeSurface);
  const tCaf = useTranslations('cloudAgentForm');
  const [saving, setSaving] = useState(false);
  // remote sub-state
  const [registerName, setRegisterName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [newHost, setNewHost] = useState<AgentHostRegistration | null>(null);
  // One-time API key copy: the write, the 2000ms "Copied!" window and its
  // unmount-safe reset all live in the shared hook.
  const copyApiKeyState = useCopyToClipboard();

  // --- Cloud agent management slide-out ------------------------------------
  const [selectedAgent, setSelectedAgent] = useState<PublishedAgent | null>(null);
  const [agentPanelTab, setAgentPanelTab] = useState<CloudAgentPanelTab>('details');

  const loadHosts = useCallback(async () => {
    setLoadingHosts(true);
    try {
      setHosts(await agentHosts.list());
    } catch (e) {
      setError(faultText(e, tWf('errLoadRemote')));
    } finally {
      setLoadingHosts(false);
    }
  }, []);

  const loadCloud = useCallback((): Promise<PublishedAgent[]> => {
    setLoadingCloud(true);
    return listMyAgents()
      .then((list) => { setCloudAgents(list); return list; })
      .catch((e) => { setError(faultText(e, tWf('errLoadCloud'))); return [] as PublishedAgent[]; })
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
        membersApi.list(String(tenant.id)),
        membersApi.listInvitations(String(tenant.id)).catch(() => [] as PendingInvitation[]),
      ]);
      setMembers(memberList);
      setPendingInvites(inviteList);
    } catch (e) {
      if (isPlanLimitError(e)) setPlanError(e);
      else setError(faultText(e, tWf('errLoadMembers')));
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
  // No copy-flag reset here any more: the shared hook expires its own confirmation
  // after 2000ms, and the key panel only exists while `newHost` is set — so there is
  // nothing left for open/close to clear.
  const openCreate = (kind: AgentKind) => {
    setCreateKind(kind);
    setForm(EMPTY_CLOUD_AGENT_FORM);
    setRegisterName('');
    setNewHost(null);
    setError('');
    setDialogOpen(true);
  };
  const closeDialog = () => {
    setDialogOpen(false);
    setForm(EMPTY_CLOUD_AGENT_FORM);
    setRegisterName('');
    setNewHost(null);
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
    if (surfaceRefusal) { setError(surfaceRefusal); return; }
    setSaving(true); setError('');
    try {
      await createCloudAgent(cloudAgentFormToInput(form));
      closeDialog(); loadCloud();
    } catch (e) {
      setError(faultText(e, tWf('errSaveFailed')));
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
        setError(faultText(e, tWf('errRegisterFailed')));
      }
    } finally {
      setRegistering(false);
    }
  };

  // A refused clipboard stays silent as before — the key input is still on screen to
  // select by hand, so the button just never flips to "Copied!".
  const copyApiKey = async () => {
    if (!newHost?.apiKey) return;
    await copyApiKeyState.copy(newHost.apiKey);
  };

  // --- Quick card actions --------------------------------------------------
  const unpublish = async (a: PublishedAgent) => { await updateAgent(a.id, { published: false }); loadCloud(); };
  const deleteOwned = async (a: PublishedAgent) => {
    if (!(await confirm(tc('deleteAgentPermanentConfirm', { name: a.name })))) return;
    try {
      await deleteAgent(a.id);
      loadCloud();
    } catch (e) {
      setError(faultText(e, tWf('errDeleteFailed')));
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
      setError(faultText(e, tWf('errUnhireFailed')));
    } finally {
      setUnhiringId(null);
    }
  };

  // --- People actions ------------------------------------------------------
  const handleRemoveMember = async (member: TenantMember) => {
    if (!tenant || !tenantToken) return;
    setRemovingMemberId(member.id);
    try {
      await membersApi.remove(String(tenant.id), member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (e) {
      if (isPlanLimitError(e)) setPlanError(e);
      else setError(faultText(e, tWf('errRemoveMember')));
    } finally {
      setRemovingMemberId(null);
      setConfirmRemove(null);
    }
  };

  const handleChangeRole = async (member: TenantMember, role: string) => {
    if (!tenant || !tenantToken || role === member.role) return;
    setChangingRoleId(member.id);
    try {
      await membersApi.updateRole(String(tenant.id), member.id, role);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role } : m)));
    } catch (e) {
      if (isPlanLimitError(e)) setPlanError(e);
      else setError(faultText(e, tWf('errChangeRole')));
    } finally {
      setChangingRoleId(null);
    }
  };

  const handleRevokeInvite = async (invite: PendingInvitation) => {
    if (!tenant || !tenantToken) return;
    setRevokingInviteId(invite.id);
    try {
      await membersApi.revokeInvitation(String(tenant.id), invite.id);
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (e) {
      setError(faultText(e, tWf('errRevokeInvite')));
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


  // The ONE Collection (PRD 47): the directory is a heterogeneous in-memory list
  // (people, pending invites, hosts, editors, cloud + hired agents) → one local
  // source over a discriminated row. Members' bulk "consolidate" stays the
  // dedicated panel, so the bulk bar is off here (read-only entity: null) — the
  // per-row actions (remove / revoke / unhire / owner actions) are in the rows.
  type DirRow =
    | { kind: 'member'; id: string; m: TenantMember }
    | { kind: 'invite'; id: string; inv: PendingInvitation }
    | { kind: 'host'; id: string; host: AgentHost }
    | { kind: 'vscode'; id: string; conn: VscodeConnection }
    | { kind: 'cloud'; id: string; a: PublishedAgent }
    | { kind: 'purchased'; id: string; a: PublishedAgent };
  const dirRows: DirRow[] = [
    ...members.map((m): DirRow => ({ kind: 'member', id: `member-${m.id}`, m })),
    ...pendingInvites.map((inv): DirRow => ({ kind: 'invite', id: `invite-${inv.id}`, inv })),
    ...hosts.map((host): DirRow => ({ kind: 'host', id: `host-${host.id}`, host })),
    ...vscodeConns.map((conn): DirRow => ({ kind: 'vscode', id: `vscode-${conn.id}`, conn })),
    ...cloudAgents.map((a): DirRow => ({ kind: 'cloud', id: `cloud-${a.id}`, a })),
    ...visiblePurchased.map((a): DirRow => ({ kind: 'purchased', id: `purchased-${a.id}`, a })),
  ];
  const dirName = (r: DirRow): string =>
    r.kind === 'member' ? (r.m.displayName ?? r.m.username ?? r.m.email)
    : r.kind === 'invite' ? r.inv.email
    : r.kind === 'host' ? r.host.name
    : r.kind === 'vscode' ? r.conn.machineName
    : r.a.name;
  const dirOrder: Record<DirRow['kind'], number> = { member: 0, invite: 1, host: 2, vscode: 3, cloud: 4, purchased: 5 };
  const dirStatus = (r: DirRow): string =>
    r.kind === 'member' ? r.m.email
    : r.kind === 'invite' ? tWf('invitedAs', { role: r.inv.role })
    : r.kind === 'host' ? (r.host.online ? tWf('statusOnline') : tWf('statusOffline'))
    : r.kind === 'vscode' ? (isVscodeConnectionOnline(r.conn) ? tWf('vscode.online') : tWf('vscode.offline'))
    : r.kind === 'cloud' ? (r.a.published ? tWf('statusPublished') : tWf('statusDraft'))
    : '—';
  const dirCard = (r: DirRow): React.ReactNode => {
    if (r.kind === 'member') {
      return <MemberCard member={r.m} onRemove={setConfirmRemove} onChangeRole={handleChangeRole} removing={removingMemberId === r.m.id} changingRole={changingRoleId === r.m.id} />;
    }
    if (r.kind === 'invite') {
      return <PendingInviteCard invite={r.inv} onRevoke={handleRevokeInvite} revoking={revokingInviteId === r.inv.id} />;
    }
    if (r.kind === 'host') {
      const host = r.host;
      const isDefault = defaultAgentHostId != null && host.id === defaultAgentHostId;
      const lastSeen = host.lastSeenAt ? fmt.dateTime(host.lastSeenAt) : '—';
      return (
        <div
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
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)' }}>{tWf('defaultBadge')}</span>
            )}
            <StatusBadge variant={host.online ? 'online' : 'offline'} />
          </div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{host.slug ?? host.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tWf('hostLastSeen', { when: lastSeen })}</div>
          <div style={{ marginTop: 4 }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedHost(host); }} style={btnPrimary}>{tWf('open')}</button>
          </div>
        </div>
      );
    }
    if (r.kind === 'vscode') {
      const conn = r.conn;
      const online = isVscodeConnectionOnline(conn);
      const lastSeen = conn.lastSeenAt ? fmt.dateTime(conn.lastSeenAt) : '—';
      return (
        <div className="card" style={cardStyle}>
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
    }
    if (r.kind === 'cloud') {
      return <AgentCard agent={r.a} manifest={agentManifests[r.a.id]} onOpenPanel={openAgentPanel} onUnpublish={unpublish} onDelete={deleteOwned} />;
    }
    return <AgentCard agent={r.a} manifest={agentManifests[r.a.id]} hired onUnhire={unhire} unhiring={unhiringId === r.a.id} />;
  };
  const dirActions = (r: DirRow): React.ReactNode => {
    if (r.kind === 'member') {
      return (
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <RoleSelect value={r.m.role} onChange={(role) => handleChangeRole(r.m, role)} busy={changingRoleId === r.m.id} compact />
          <button type="button" style={btnSubtle} disabled={removingMemberId === r.m.id} onClick={() => setConfirmRemove(r.m)}>
            {removingMemberId === r.m.id ? tWf('removing') : tWf('remove')}
          </button>
        </span>
      );
    }
    if (r.kind === 'invite') {
      return (
        <button type="button" style={btnSubtle} disabled={revokingInviteId === r.inv.id} onClick={() => handleRevokeInvite(r.inv)}>
          {revokingInviteId === r.inv.id ? tWf('revoking') : tWf('revoke')}
        </button>
      );
    }
    if (r.kind === 'host') {
      return <button type="button" onClick={() => setSelectedHost(r.host)} style={btnSubtle}>{tWf('open')}</button>;
    }
    if (r.kind === 'vscode') return null;
    if (r.kind === 'cloud') {
      return <AgentOwnerActions agent={r.a} onOpenPanel={openAgentPanel} onUnpublish={unpublish} onDelete={deleteOwned} includeEditPrice={false} />;
    }
    return (
      <button type="button" style={btnSubtle} disabled={unhiringId === r.a.id} onClick={() => unhire(r.a.id)}>
        {unhiringId === r.a.id ? tWf('unhiring') : tWf('unhire')}
      </button>
    );
  };
  const dirPill = (r: DirRow): React.ReactNode =>
    r.kind === 'member' ? <AgentTypePill kind="human" />
    : r.kind === 'invite' ? <AgentTypePill kind="pending" />
    : r.kind === 'host' ? <AgentTypePill kind="host" />
    : r.kind === 'vscode' ? <AgentTypePill kind="vscode" />
    : r.kind === 'cloud' ? <AgentTypePill kind="cloud" />
    : <AgentTypePill kind="marketplace" />;
  const directoryDescriptor: CollectionDescriptor<DirRow> = {
    entity: null,
    surfaceKey: 'workforce.directory',
    rowId: (r) => r.id,
    label: dirName,
    defaultView: 'card',
    defaultSort: { key: 'type', dir: 'asc' },
    emptyKey: 'emptyWorkforceAgents',
    columns: [
      { key: 'name', header: tWf('colName'), sortKey: 'name', compare: (x, y) => dirName(x).localeCompare(dirName(y)), cell: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {dirName(r)}
          {(r.kind === 'cloud' || r.kind === 'purchased') && <BuiltinKindBadge kind={r.a.builtin_kind} />}
          {r.kind === 'host' && defaultAgentHostId != null && r.host.id === defaultAgentHostId && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)' }}>{tWf('defaultBadge')}</span>
          )}
        </span>
      ) },
      { key: 'type', header: tWf('colType'), sortKey: 'type', compare: (x, y) => dirOrder[x.kind] - dirOrder[y.kind], cell: dirPill },
      { key: 'status', header: tWf('colStatus'), cell: dirStatus },
      { key: 'runtime', header: tWf('colRuntime'), cell: (r) =>
        r.kind === 'member' ? roleText.label(r.m.role)
        : r.kind === 'host' ? tWf('runtimeRemote')
        : r.kind === 'vscode' ? tWf('vscode.runtime')
        : r.kind === 'cloud' || r.kind === 'purchased' ? RUNTIME_LABELS[r.a.runtime_support ?? 'cloud']
        : '—' },
      { key: 'price', header: tWf('colPrice'), cell: (r) => (r.kind === 'cloud' || r.kind === 'purchased') ? formatAgentPrice(r.a) : '—' },
      { key: 'config', header: tWf('colConfiguration'), cell: (r) =>
        (r.kind === 'cloud' || r.kind === 'purchased') ? <AgentManifestInline agent={r.a} manifest={agentManifests[r.a.id]} />
        : r.kind === 'vscode' ? (r.conn.extensionVersion ?? '—')
        : '—' },
      { key: 'actions', header: '', align: 'end', cell: dirActions },
    ],
    card: dirCard,
  };
  const visibleDirRows = (() => {
    const q = dirSearch.trim().toLowerCase();
    return q ? dirRows.filter((r) => dirName(r).toLowerCase().includes(q)) : dirRows;
  })();
  const directorySource = useLocalSource(visibleDirRows, directoryDescriptor, { key: 'type', dir: 'asc' }, { page: 1, pageSize: 250 });

  return (
   <WorkforceMetricsProvider>
    <section data-tour="demo-roster">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>{tWf('workforceTitle')}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {canConsolidate && (
          <button type="button" onClick={() => setConsolidateOpen(true)} style={inviteBtn}>
            {selectedMembers.length > 0 ? tWf('consolidateActionCount', { count: selectedMembers.length }) : tWf('consolidateAction')}
          </button>
        )}
        {tenant && tenantToken && (
          <RoleGate capability="members.invite">
            <button type="button" onClick={() => setInviteOpen(true)} style={inviteBtn}>{tWf('inviteAction')}</button>
          </RoleGate>
        )}
        <SplitButton
          size="sm"
          primaryLabel={tWf('addAgentAction')}
          onPrimary={() => openCreate('cloud')}
          primaryWrapper={(button) => <RoleGate capability="agents.create">{button}</RoleGate>}
          menuAriaLabel={tWf('quickstartAria')}
          renderMenu={(close) => (
            <ConfiguredQuickstartPopover
              workgroupName={tenant?.name ?? tWf('workgroupFallback')}
              workgroupSlug={tenant?.slug}
              tenantToken={tenantToken}
              onClose={close}
            />
          )}
        />
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        {tWf('intro')}
      </p>

      <div style={{ marginBottom: 16 }}>
        <ActiveRunsPanel />
      </div>
      <ManagedAgentHostPanel tenantId={tenantId} />

      {error && !dialogOpen && (
        <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--error-text)' }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: 24 }}>{tWf('loadingWorkforce')}</div>
      ) : isEmpty ? (
        <div className="empty-state" style={{ padding: 48 }}>
          <div className="empty-state-icon"><Icon source="📁" size="1em" /></div>
          <div className="empty-state-title">{tWf('emptyTitle')}</div>
          <div className="empty-state-sub">{tWf('emptySub')}</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <RoleGate capability="members.invite">
              <button type="button" onClick={() => setInviteOpen(true)} style={{ ...inviteBtn, padding: '10px 18px', fontSize: 14, borderRadius: 'var(--radius-lg)' }}>
                {tWf('inviteTeammate')}
              </button>
            </RoleGate>
            <RoleGate capability="agents.create">
              <button type="button" onClick={() => openCreate('cloud')} style={{ ...btnPrimary, padding: '10px 18px', fontSize: 14, borderRadius: 'var(--radius-lg)' }}>
                {tWf('addAgent')}
              </button>
            </RoleGate>
          </div>
        </div>
      ) : (
        <Collection
          descriptor={directoryDescriptor}
          source={directorySource}
          search={dirSearch}
          onSearchChange={setDirSearch}
        />
      )}

      {/* Fleet mesh visualization */}
      {hosts.length > 1 && (
        <div style={{ marginTop: 36 }}>
          <FleetMeshContent agentHosts={hosts} />
        </div>
      )}

      {/* Invite a teammate slide-out */}
      {tenant && tenantToken && (
        <SlideOutPanel open={inviteOpen} onClose={() => setInviteOpen(false)} title={tWf('inviteTeammate')} widthStorageKey="workforce-invite">
          <div style={{ padding: 20 }}>
            <InviteTeamMembers
              tenantId={String(tenant.id)}
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
        width="sheet"
        widthStorageKey="workforce-add-agent"
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
                  <button type="button" onClick={copyApiKey} style={btnPrimary}>{copyApiKeyState.copied ? tAdd('copied') : tAdd('copy')}</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" onClick={closeDialog} style={btnPrimary}>{tAdd('done')}</button>
              </div>
            </>
          ) : (
            <>
              {/* Type toggle */}
              <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {(['cloud', 'host'] as AgentKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => { setCreateKind(k); setError(''); }}
                    style={{
                      flex: 1, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                      background: createKind === k ? 'var(--accent)' : 'transparent',
                      color: createKind === k ? 'var(--text-on-accent)' : 'var(--text-strong)',
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
                    <button type="button" onClick={createCloud} disabled={saving || !form.name.trim() || !!surfaceRefusal} style={btnPrimary}>
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
