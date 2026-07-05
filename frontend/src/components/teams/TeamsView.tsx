'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { useAuth } from '@/lib/AuthContext';
import {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  addTeamProject,
  removeTeamProject,
  listWorkforceDirectory,
  type TeamSummary,
  type TeamDetail,
  type TeamMemberKind,
  type WorkforceOption,
} from '@/lib/teams';
import { fetchProjects } from '@/lib/api';
import type { Project } from '@/lib/types';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';

/**
 * Workforce → Teams. Groups the workforce (agents AND humans) into named teams
 * and attaches a team to projects. Mirrors the other Workforce collection
 * surfaces: a Card | List toggle over the team list, a "New team" slide-out for
 * create, and a per-team management slide-out (rename, members, projects, delete).
 * Self-contained — pulls auth from context and renders nothing until a workspace
 * is selected; the host page owns the heading chrome.
 */

const KIND_ACCENT: Record<TeamMemberKind, string> = {
  human: '#3b82f6',
  cloud_agent: 'var(--coral-bright)',
  host_agent: '#22c55e',
};

const btnPrimary: React.CSSProperties = {
  padding: '7px 16px', fontSize: 13, fontWeight: 600,
  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
  color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
};
const btnSubtle: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)',
  background: 'transparent', border: '1px solid var(--coral-bright)', borderRadius: 8, cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13, color: 'var(--text-primary)',
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 8, boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6,
};
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, margin: '0 0 10px' };

/** Pencil-in-square "manage" glyph. Kept always-visible (not hover-only) so the
 *  card reads as interactive on touch devices too; it tints coral on hover. */
function ManageIcon({ active }: { active: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? 'var(--coral-bright)' : 'var(--text-muted)'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, transition: 'stroke 120ms' }}
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function MemberPill({ kind }: { kind: TeamMemberKind }) {
  const t = useTranslations('workforce.teams');
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
        background: 'color-mix(in srgb, ' + KIND_ACCENT[kind] + ' 15%, transparent)',
        color: KIND_ACCENT[kind], letterSpacing: 0.3, whiteSpace: 'nowrap',
      }}
    >
      {t(`kind.${kind}`)}
    </span>
  );
}

export function TeamsView() {
  const { tenant, tenantToken } = useAuth();
  const t = useTranslations('workforce.teams');
  const tc = useTranslations('common');

  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  // Create slide-out
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Manage slide-out (selected team detail)
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TeamSummary | TeamDetail | null>(null);

  // Picker pools (loaded once when a team is opened)
  const [workforce, setWorkforce] = useState<WorkforceOption[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const loadTeams = useCallback(async () => {
    if (!tenant || !tenantToken) return;
    setLoading(true);
    setError(null);
    try {
      setTeams(await listTeams());
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errLoadTeams'));
    } finally {
      setLoading(false);
    }
  }, [tenant, tenantToken, t]);

  useEffect(() => { void loadTeams(); }, [loadTeams]);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const [d, wf, projs] = await Promise.all([
        getTeam(id),
        workforce.length ? Promise.resolve(workforce) : listWorkforceDirectory(),
        projects.length ? Promise.resolve(projects) : fetchProjects(),
      ]);
      setDetail(d);
      setWorkforce(wf);
      setProjects(projs);
      // The detail read is uncached and therefore authoritative. Reconcile the
      // matching card/row in the (cached, possibly-stale) summary list from it so
      // the count on the card can never diverge from the panel the user is
      // looking at — this is what fixed "card says 1 member, panel shows 6".
      setTeams((prev) =>
        prev.map((t) =>
          t.id === d.id ? { ...t, memberCount: d.members.length, projectCount: d.projects.length } : t,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errLoadTeam'));
    } finally {
      setDetailLoading(false);
    }
  }, [workforce, projects, t]);

  const openTeam = (id: number) => { setSelectedId(id); void loadDetail(id); };
  const closeTeam = () => { setSelectedId(null); setDetail(null); };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createTeam({ name, description: newDesc.trim() || undefined });
      setNewName(''); setNewDesc(''); setCreateOpen(false);
      await loadTeams();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errCreate'));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteTeam(id);
      setConfirmDelete(null);
      closeTeam();
      await loadTeams();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errDelete'));
    }
  };

  // --- member / project mutations operate on the open detail, then refresh ---
  // A membership/project change only affects THIS team's counts, so reloading the
  // authoritative detail (which reconciles its own card in the summary list) is
  // enough. We deliberately do NOT refetch the whole list here: that cached read
  // can lag the just-written value on another isolate and would clobber the
  // reconciled count back to a stale number.
  const refreshAfterMutation = async (id: number) => {
    await loadDetail(id);
  };

  const handleAddMember = async (opt: WorkforceOption) => {
    if (!detail) return;
    await addTeamMember(detail.id, { memberKind: opt.kind, memberRef: opt.ref, memberName: opt.name });
    await refreshAfterMutation(detail.id);
  };
  const handleRemoveMember = async (memberId: number) => {
    if (!detail) return;
    await removeTeamMember(detail.id, memberId);
    await refreshAfterMutation(detail.id);
  };
  const handleAddProject = async (projectId: number) => {
    if (!detail) return;
    await addTeamProject(detail.id, projectId);
    await refreshAfterMutation(detail.id);
  };
  const handleRemoveProject = async (projectId: number) => {
    if (!detail) return;
    await removeTeamProject(detail.id, projectId);
    await refreshAfterMutation(detail.id);
  };

  if (!tenant || !tenantToken) return null;

  return (
    <>
      {/* Create slide-out */}
      <SlideOutPanel open={createOpen} onClose={() => setCreateOpen(false)} title={t('new')}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>{t('name')}</label>
            <input
              style={inputStyle}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('namePlaceholder')}
              autoFocus
            />
          </div>
          <div>
            <label style={labelStyle}>{t('description')}</label>
            <textarea
              style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" style={btnSubtle} onClick={() => setCreateOpen(false)}>{tc('cancel')}</button>
            <button
              type="button"
              style={{ ...btnPrimary, opacity: creating || !newName.trim() ? 0.6 : 1 }}
              disabled={creating || !newName.trim()}
              onClick={() => void handleCreate()}
            >
              {creating ? t('creating') : t('create')}
            </button>
          </div>
        </div>
      </SlideOutPanel>

      {/* Manage slide-out */}
      <SlideOutPanel
        open={selectedId !== null}
        onClose={closeTeam}
        title={detail?.name ?? t('titleFallback')}
        headerActions={
          detail ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(detail)}
              style={{ ...btnSubtle, color: '#ef4444', borderColor: '#ef4444' }}
            >
              {tc('delete')}
            </button>
          ) : undefined
        }
      >
        {detailLoading && !detail ? (
          <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</div>
        ) : detail ? (
          <TeamDetailPanel
            key={detail.id}
            detail={detail}
            workforce={workforce}
            projects={projects}
            onSaveMeta={async (name, description) => {
              await updateTeam(detail.id, { name, description });
              await refreshAfterMutation(detail.id);
            }}
            onAddMember={handleAddMember}
            onRemoveMember={handleRemoveMember}
            onAddProject={handleAddProject}
            onRemoveProject={handleRemoveProject}
          />
        ) : null}
      </SlideOutPanel>

      {/* Team list */}
      <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
            {t('heading')}
            {!loading && (
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8 }}>
                ({teams.length})
              </span>
            )}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <button type="button" style={btnPrimary} onClick={() => setCreateOpen(true)}>{t('new')}</button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>{t('loadingTeams')}</div>
        ) : teams.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
            {t('empty', { action: t('new') })}
          </div>
        ) : viewMode === 'card' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => openTeam(team.id)}
                onMouseEnter={() => setHoveredId(team.id)}
                onMouseLeave={() => setHoveredId((h) => (h === team.id ? null : h))}
                aria-label={t('manageTeam', { name: team.name })}
                style={{
                  textAlign: 'left', padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
                  background: 'var(--bg-base)',
                  border: `1px solid ${hoveredId === team.id ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                  borderRadius: 12, cursor: 'pointer',
                  boxShadow: hoveredId === team.id ? '0 4px 14px rgba(0,0,0,0.10)' : 'none',
                  transform: hoveredId === team.id ? 'translateY(-1px)' : 'none',
                  transition: 'border-color 120ms, box-shadow 120ms, transform 120ms',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{team.name}</div>
                  <ManageIcon active={hoveredId === team.id} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', minHeight: 32, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {team.description || t('noDescription')}
                </div>
                <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>
                  <span>{t.rich('memberCount', { count: team.memberCount, b: (c) => <strong style={{ color: 'var(--text-primary)' }}>{c}</strong> })}</span>
                  <span>{t.rich('projectCount', { count: team.projectCount, b: (c) => <strong style={{ color: 'var(--text-primary)' }}>{c}</strong> })}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('colTeam')}</th>
                  <th style={thStyle}>{t('colDescription')}</th>
                  <th style={thStyle}>{t('colMembers')}</th>
                  <th style={thStyle}>{t('colProjects')}</th>
                  <th style={{ ...thStyle, width: 40 }} aria-label={t('manage')} />
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <tr
                    key={team.id}
                    style={{ ...trStyle, cursor: 'pointer', background: hoveredId === team.id ? 'var(--bg-hover, rgba(127,127,127,0.06))' : undefined }}
                    onClick={() => openTeam(team.id)}
                    onMouseEnter={() => setHoveredId(team.id)}
                    onMouseLeave={() => setHoveredId((h) => (h === team.id ? null : h))}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{team.name}</td>
                    <td style={tdMutedStyle}>{team.description || '—'}</td>
                    <td style={tdStyle}>{team.memberCount}</td>
                    <td style={tdStyle}>{team.projectCount}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', width: 40 }}>
                      <ManageIcon active={hoveredId === team.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!confirmDelete}
        message={confirmDelete ? t('deleteConfirm', { name: confirmDelete.name }) : ''}
        confirmLabel={tc('delete')}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void handleDelete(confirmDelete.id); }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail panel body — rename + members + projects management.
// ---------------------------------------------------------------------------

function TeamDetailPanel({
  detail,
  workforce,
  projects,
  onSaveMeta,
  onAddMember,
  onRemoveMember,
  onAddProject,
  onRemoveProject,
}: {
  detail: TeamDetail;
  workforce: WorkforceOption[];
  projects: Project[];
  onSaveMeta: (name: string, description: string | null) => Promise<void>;
  onAddMember: (opt: WorkforceOption) => Promise<void>;
  onRemoveMember: (memberId: number) => Promise<void>;
  onAddProject: (projectId: number) => Promise<void>;
  onRemoveProject: (projectId: number) => Promise<void>;
}) {
  const t = useTranslations('workforce.teams');
  const tc = useTranslations('common');
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description ?? '');
  const [savingMeta, setSavingMeta] = useState(false);
  const [busy, setBusy] = useState(false);
  const [memberPick, setMemberPick] = useState('');
  const [projectPick, setProjectPick] = useState('');

  // Local edit state is seeded from props at mount. The parent remounts this
  // panel (key={detail.id}) when a different team is opened, so no reset effect
  // is needed — and a re-render after a save re-seeds from the refreshed detail.
  const metaDirty = name.trim() !== detail.name || (description.trim() || '') !== (detail.description ?? '');

  // Already-added entities are excluded from the picker (a workforce entity can
  // be in many teams, but not the same team twice).
  const memberKey = (kind: TeamMemberKind, ref: string) => `${kind}:${ref}`;
  const existing = useMemo(
    () => new Set(detail.members.map((m) => memberKey(m.memberKind, m.memberRef))),
    [detail.members],
  );
  const availableWorkforce = workforce.filter((w) => !existing.has(memberKey(w.kind, w.ref)));

  const attachedProjectIds = useMemo(() => new Set(detail.projects.map((p) => p.id)), [detail.projects]);
  const availableProjects = projects.filter((p) => !attachedProjectIds.has(p.id));

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* Meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle}>{t('name')}</label>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>{t('description')}</label>
          <textarea
            style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {metaDirty && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={{ ...btnPrimary, opacity: savingMeta || !name.trim() ? 0.6 : 1 }}
              disabled={savingMeta || !name.trim()}
              onClick={() => void wrap(async () => {
                setSavingMeta(true);
                try { await onSaveMeta(name.trim(), description.trim() || null); }
                finally { setSavingMeta(false); }
              })}
            >
              {savingMeta ? t('savingChanges') : t('saveChanges')}
            </button>
          </div>
        )}
      </div>

      {/* Members */}
      <div>
        <h3 style={sectionTitle}>{t('membersSection', { count: detail.members.length })}</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Select
            style={{ ...inputStyle, flex: 1 }}
            value={memberPick}
            onChange={(e) => setMemberPick(e.target.value)}
            disabled={busy || availableWorkforce.length === 0}
          >
            <option value="">
              {availableWorkforce.length === 0 ? t('allAdded') : t('addMemberPlaceholder')}
            </option>
            {availableWorkforce.map((w) => (
              <option key={memberKey(w.kind, w.ref)} value={memberKey(w.kind, w.ref)}>
                {t('memberOption', { name: w.name, kind: t(`kind.${w.kind}`) })}
              </option>
            ))}
          </Select>
          <button
            type="button"
            style={{ ...btnPrimary, opacity: !memberPick || busy ? 0.6 : 1 }}
            disabled={!memberPick || busy}
            onClick={() => {
              const opt = availableWorkforce.find((w) => memberKey(w.kind, w.ref) === memberPick);
              if (opt) void wrap(async () => { await onAddMember(opt); setMemberPick(''); });
            }}
          >
            {t('add')}
          </button>
        </div>
        {detail.members.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noMembers')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {detail.members.map((m, idx) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: idx === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.memberName}
                </div>
                <MemberPill kind={m.memberKind} />
                <button type="button" style={{ ...btnSubtle, padding: '4px 10px' }} disabled={busy} onClick={() => void wrap(() => onRemoveMember(m.id))}>
                  {t('remove')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Projects */}
      <div>
        <h3 style={sectionTitle}>{t('projectsSection', { count: detail.projects.length })}</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Select
            style={{ ...inputStyle, flex: 1 }}
            value={projectPick}
            onChange={(e) => setProjectPick(e.target.value)}
            disabled={busy || availableProjects.length === 0}
          >
            <option value="">
              {availableProjects.length === 0 ? t('noMoreProjects') : t('attachPlaceholder')}
            </option>
            {availableProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.key ? ` (${p.key})` : ''}</option>
            ))}
          </Select>
          <button
            type="button"
            style={{ ...btnPrimary, opacity: !projectPick || busy ? 0.6 : 1 }}
            disabled={!projectPick || busy}
            onClick={() => { const pid = Number(projectPick); if (pid) void wrap(async () => { await onAddProject(pid); setProjectPick(''); }); }}
          >
            {t('attach')}
          </button>
        </div>
        {detail.projects.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noProjects')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {detail.projects.map((p, idx) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: idx === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.key}</span>
                <button type="button" style={{ ...btnSubtle, padding: '4px 10px' }} disabled={busy} onClick={() => void wrap(() => onRemoveProject(p.id))}>
                  {t('detach')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
