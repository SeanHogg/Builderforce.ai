'use client';

/**
 * KanbanRosterCard — the project-settings surface for the Agentic Workforce Kanban.
 * Picks the board's kanban template, shows the recommended roster (which roles are
 * filled by a human/agent and which are gaps to hire/build), and surfaces flagged
 * tickets from the per-ticket role/diagnostic audit. Self-contained: fetches its own
 * data and decides its own visibility for manager-only actions.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { kanbanApi } from '@/lib/builderforceApi';
import { createCloudAgent } from '@/lib/api';
import { usePermission } from '@/lib/rbac';
import type { RecommendedRoster, TemplateSummary, FlaggedTicket, RosterRole, AssigneeKind } from '@/lib/kanban';
import { RoleAssigneePicker, useAssignableWorkforce } from '@/components/workforce/RoleAssigneePicker';

const chip = (bg: string, fg: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 999,
  fontSize: 11, fontWeight: 600, background: bg, color: fg,
});

export function KanbanRosterCard({ projectId }: { projectId: number }) {
  const t = useTranslations('kanban');
  const canManage = usePermission('agents.create').allowed;
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [roster, setRoster] = useState<RecommendedRoster | null>(null);
  const [flagged, setFlagged] = useState<FlaggedTicket[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [assigningRole, setAssigningRole] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only fetch the assignable pools once the manager actually opens a picker.
  const workforce = useAssignableWorkforce(assigningRole != null);

  const load = useCallback(async () => {
    try {
      const [tpls, rost, flg] = await Promise.all([
        kanbanApi.listTemplates().catch(() => [] as TemplateSummary[]),
        kanbanApi.roster(projectId),
        kanbanApi.flaggedForProject(projectId).catch(() => [] as FlaggedTicket[]),
      ]);
      setTemplates(tpls);
      setRoster(rost);
      setFlagged(flg);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const onPickTemplate = async (templateId: string) => {
    if (!templateId || templateId === roster?.templateId) return;
    setBusy(true); setError(null);
    try {
      await kanbanApi.applyTemplate(projectId, templateId);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const onCreateAgent = async (role: RosterRole) => {
    setCreating(role.roleKey); setError(null);
    try {
      await createCloudAgent({ name: `${role.name} Agent`, title: role.name, skills: [role.roleKey], published: false });
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setCreating(null); }
  };

  const onAssign = async (roleKey: string, a: { assigneeKind: AssigneeKind; assigneeRef: string; assigneeName: string }) => {
    setAssignBusy(true); setError(null);
    try {
      await kanbanApi.assignRole({ roleKey, ...a, projectId });
      setAssigningRole(null);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setAssignBusy(false); }
  };

  const onUnassign = async (assignmentId: string) => {
    setError(null);
    try {
      await kanbanApi.unassignRole(assignmentId);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 16,
  };

  return (
    <div style={cardStyle} id="kanban-roster">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{t('rosterTitle')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('rosterSubtitle')}</div>
        </div>
        {roster && (
          <span style={chip('var(--surface-2)', 'var(--text-secondary)')}>
            {t('coverageSummary', { filled: roster.filledCount, total: roster.roles.length })}
          </span>
        )}
      </div>

      {/* Template picker */}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label htmlFor="kanban-template" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('templateLabel')}</label>
        <select
          id="kanban-template"
          disabled={!canManage || busy}
          value={roster?.templateId ?? ''}
          onChange={(e) => onPickTemplate(e.target.value)}
          style={{
            flex: '1 1 200px', minWidth: 180, padding: '6px 8px', borderRadius: 8, fontSize: 13,
            background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border)',
          }}
        >
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}{tpl.builtin ? ` · ${t('builtin')}` : ''}
            </option>
          ))}
        </select>
        {busy && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('applying')}</span>}
      </div>

      {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger-text, #dc2626)' }}>{error}</div>}

      {/* Roster */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {roster?.roles.map((role) => {
          const assigned = role.filledBy.filter((f) => f.via === 'assignment' && f.assignmentId);
          const kindLabel = (k: string) => t(k === 'agent' ? 'assigneeAgent' : k === 'hire' ? 'assigneeHire' : 'assigneeHuman');
          return (
          <div key={role.roleKey} style={{
            display: 'flex', flexDirection: 'column', gap: 8,
            padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16 }} aria-hidden>{role.icon ?? '👤'}</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{role.name}</span>
              {role.required
                ? <span style={chip('var(--warning-bg, #fef3c7)', 'var(--warning-text, #92400e)')}>{t('required')}</span>
                : <span style={chip('var(--surface)', 'var(--text-muted)')}>{t('optional')}</span>}
              <span style={{ flex: 1 }} />
              {role.status === 'filled'
                ? <span style={chip('var(--success-bg, #dcfce7)', 'var(--success-text, #166534)')} title={role.filledBy.map((f) => f.name).join(', ')}>
                    ✓ {t('filled')}
                  </span>
                : <span style={chip('var(--danger-bg, #fee2e2)', 'var(--danger-text, #991b1b)')}>{t('gap')}</span>}
              {canManage && (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setAssigningRole(assigningRole === role.roleKey ? null : role.roleKey)}
                    style={{
                      fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                      background: 'transparent', color: 'var(--accent, #2563eb)', border: '1px solid var(--accent, #2563eb)',
                    }}
                  >
                    {t('assign')}
                  </button>
                  {role.status === 'gap' && (
                    <button
                      type="button"
                      onClick={() => onCreateAgent(role)}
                      disabled={creating === role.roleKey}
                      style={{
                        fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                        background: 'var(--accent, #2563eb)', color: '#fff', border: 'none',
                      }}
                    >
                      {creating === role.roleKey ? t('creating') : t('createAgent')}
                    </button>
                  )}
                </span>
              )}
            </div>

            {/* Explicitly-assigned members — removable chips. */}
            {assigned.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {assigned.map((f) => (
                  <span key={f.assignmentId} style={{ ...chip('var(--surface)', 'var(--text-secondary)'), border: '1px solid var(--border-subtle)' }}>
                    <span aria-hidden>{f.kind === 'agent' ? '🤖' : f.kind === 'hire' ? '🤝' : '🧑'}</span>
                    {f.name}
                    <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>· {kindLabel(f.kind)}</span>
                    {canManage && (
                      <button
                        type="button"
                        aria-label={t('unassign')}
                        onClick={() => onUnassign(f.assignmentId!)}
                        style={{ marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1, padding: 0 }}
                      >×</button>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* Inline assignee picker. */}
            {canManage && assigningRole === role.roleKey && (
              <RoleAssigneePicker
                workforce={workforce}
                busy={assignBusy}
                onAssign={(a) => onAssign(role.roleKey, a)}
                onCancel={() => setAssigningRole(null)}
              />
            )}
          </div>
          );
        })}
        {roster && roster.roles.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noRoles')}</div>
        )}
      </div>

      {/* Flagged tickets from the ticket audit */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
          {t('auditTitle')} {flagged.length > 0 && (
            <span style={chip('var(--danger-bg, #fee2e2)', 'var(--danger-text, #991b1b)')}>{flagged.length}</span>
          )}
        </div>
        {flagged.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noFlagged')}</div>
          : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {flagged.slice(0, 8).map((f) => (
                <li key={f.taskId} style={{ fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>#{f.taskId} {f.title}</span>
                  <span style={{ color: 'var(--text-muted)' }}> — {t('coverage', { pct: f.coverage })}</span>
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                    {f.missing.slice(0, 4).map((m, i) => (
                      <span key={i} style={{ marginRight: 8 }}>
                        {m.reason === 'changes_requested' ? '↺' : '•'} {m.laneName}: {m.ref}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
