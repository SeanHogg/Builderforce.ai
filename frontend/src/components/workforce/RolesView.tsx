'use client';

/**
 * RolesView — the Workforce → Roles tab. Shows the role roster a team fills: the
 * standard roles the selected board template calls for, plus any custom roles the
 * workspace has added, and lets a manager pin an existing Agent / Employee / Hire to
 * each role as a WORKSPACE-DEFAULT assignment (applies to every project's roster).
 * Self-contained: fetches its own roles/templates/assignments and gates writes on
 * the manager permission.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { kanbanApi } from '@/lib/builderforceApi';
import { usePermission } from '@/lib/rbac';
import { ROLE_DISCIPLINES, useRoles } from '@/lib/useRoles';
import type { JobRole, TemplateSummary, RoleAssignment, AssigneeKind, Discipline } from '@/lib/kanban';
import { RoleAssigneePicker, useAssignableWorkforce } from './RoleAssigneePicker';
import { useConfirm } from '@/components/ConfirmProvider';

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16 };
const chip = (bg: string, fg: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: bg, color: fg,
});
const input: React.CSSProperties = { background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 13, outline: 'none' };

export function RolesView() {
  const t = useTranslations('workforceRoles');
  const confirm = useConfirm();
  const tk = useTranslations('kanban');
  const canManage = usePermission('agents.create').allowed;
  const workforce = useAssignableWorkforce();

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [standardKeys, setStandardKeys] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { roles, creating, reloadRoles, createRole, deleteRole } = useRoles({ onError: setError });

  const [assigningRole, setAssigningRole] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<{ name: string; discipline: Discipline }>({ name: '', discipline: 'engineering' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [, tpls, asg] = await Promise.all([
        reloadRoles(),
        kanbanApi.listTemplates().catch(() => [] as TemplateSummary[]),
        kanbanApi.listRoleAssignments().catch(() => [] as RoleAssignment[]),
      ]);
      setTemplates(tpls);
      setAssignments(asg);
      if (!templateId && tpls.length > 0) setTemplateId(tpls[0].id);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [templateId, reloadRoles]);

  useEffect(() => { void load(); }, [load]);

  // Resolve the selected template's standard role set (role/review requirement refs).
  useEffect(() => {
    if (!templateId) { setStandardKeys(new Set()); return; }
    let cancelled = false;
    kanbanApi.getTemplate(templateId)
      .then((tpl) => {
        if (cancelled) return;
        const keys = new Set<string>();
        for (const lane of tpl.lanes) {
          for (const req of lane.requirements) {
            if (req.kind === 'role' || req.kind === 'review') keys.add(req.ref);
          }
        }
        setStandardKeys(keys);
      })
      .catch(() => { if (!cancelled) setStandardKeys(new Set()); });
    return () => { cancelled = true; };
  }, [templateId]);

  const assignmentsByRole = useMemo(() => {
    const m = new Map<string, RoleAssignment[]>();
    for (const a of assignments) {
      const list = m.get(a.roleKey) ?? [];
      list.push(a);
      m.set(a.roleKey, list);
    }
    return m;
  }, [assignments]);

  // Standard roles for the chosen template first, then the rest.
  const sortedRoles = useMemo(() => {
    return [...roles].sort((a, b) => {
      const sa = standardKeys.has(a.key) ? 0 : 1;
      const sb = standardKeys.has(b.key) ? 0 : 1;
      return sa - sb || a.position - b.position;
    });
  }, [roles, standardKeys]);

  const onAssign = async (roleKey: string, a: { assigneeKind: AssigneeKind; assigneeRef: string; assigneeName: string }) => {
    setAssignBusy(true); setError(null);
    try {
      await kanbanApi.assignRole({ roleKey, ...a }); // projectId omitted → workspace default
      setAssigningRole(null);
      setAssignments(await kanbanApi.listRoleAssignments());
    } catch (e) { setError((e as Error).message); }
    finally { setAssignBusy(false); }
  };

  const onUnassign = async (id: string) => {
    setError(null);
    try {
      await kanbanApi.unassignRole(id);
      setAssignments((prev) => prev.filter((a) => a.id !== id));
    } catch (e) { setError((e as Error).message); }
  };

  const onCreate = async () => {
    setError(null);
    if (await createRole(form.name, form.discipline)) {
      setForm({ name: '', discipline: 'engineering' });
      setShowNew(false);
    }
  };

  const onDeleteRole = async (role: JobRole) => {
    if (role.builtin) return;
    if (!(await confirm(t('deleteConfirm', { name: role.name })))) return;
    setError(null);
    await deleteRole(role);
  };

  const kindLabel = (k: string) => tk(k === 'agent' ? 'assigneeAgent' : k === 'hire' ? 'assigneeHire' : 'assigneeHuman');

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-strong)', margin: 0 }}>{t('title')}</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 0' }}>{t('subtitle')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('templateLabel')}</label>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ ...input, minWidth: 180 }}>
            {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
          </select>
          {canManage && (
            <button type="button" onClick={() => setShowNew((v) => !v)} style={{ fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', background: 'var(--accent, #2563eb)', color: '#fff', border: 'none' }}>
              {t('newRole')}
            </button>
          )}
        </div>
      </div>

      {error && <div style={{ ...card, color: 'var(--coral-bright, #ef4444)', fontSize: 13, marginBottom: 12, padding: 12 }}>{error}</div>}

      {showNew && canManage && (
        <div style={{ ...card, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: '1 1 200px' }} placeholder={t('roleNamePlaceholder')} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <select style={input} value={form.discipline} onChange={(e) => setForm((f) => ({ ...f, discipline: e.target.value as Discipline }))}>
            {ROLE_DISCIPLINES.map((d) => <option key={d} value={d}>{t(`discipline.${d}`)}</option>)}
          </select>
          <button type="button" disabled={creating || !form.name.trim()} onClick={onCreate} style={{ fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', background: 'var(--accent, #2563eb)', color: '#fff', border: 'none', opacity: creating || !form.name.trim() ? 0.6 : 1 }}>
            {creating ? t('creating') : t('addRole')}
          </button>
          <button type="button" onClick={() => setShowNew(false)} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            {tk('assignCancel')}
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: 24 }}>{t('loading')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sortedRoles.map((role) => {
            const roleAssignments = assignmentsByRole.get(role.key) ?? [];
            const isStandard = standardKeys.has(role.key);
            return (
              <div key={role.key} style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 16 }} aria-hidden>{role.icon ?? '👤'}</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-strong)' }}>{role.name}</span>
                  {isStandard && <span style={chip('var(--surface-coral-soft, #eef2ff)', 'var(--accent, #2563eb)')}>{t('standard')}</span>}
                  {role.builtin
                    ? <span style={chip('var(--surface-2)', 'var(--text-muted)')}>{tk('builtin')}</span>
                    : <span style={chip('var(--surface-2)', 'var(--text-secondary)')}>{t('custom')}</span>}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t(`discipline.${role.discipline}`)}</span>
                  <span style={{ flex: 1 }} />
                  {canManage && (
                    <button type="button" onClick={() => setAssigningRole(assigningRole === role.key ? null : role.key)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'var(--accent, #2563eb)', border: '1px solid var(--accent, #2563eb)' }}>
                      {tk('assign')}
                    </button>
                  )}
                  {canManage && !role.builtin && (
                    <button type="button" onClick={() => onDeleteRole(role)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                      {t('delete')}
                    </button>
                  )}
                </div>

                {role.description && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{role.description}</div>}

                {roleAssignments.length > 0 ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {roleAssignments.map((a) => (
                      <span key={a.id} style={{ ...chip('var(--surface-2)', 'var(--text-secondary)'), border: '1px solid var(--border-subtle)' }}>
                        <span aria-hidden>{a.assigneeKind === 'agent' ? '🤖' : a.assigneeKind === 'hire' ? '🤝' : '🧑'}</span>
                        {a.assigneeName ?? a.assigneeRef}
                        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>· {kindLabel(a.assigneeKind)}</span>
                        {canManage && (
                          <button type="button" aria-label={tk('unassign')} onClick={() => onUnassign(a.id)} style={{ marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noneAssigned')}</div>
                )}

                {canManage && assigningRole === role.key && (
                  <RoleAssigneePicker
                    workforce={workforce}
                    busy={assignBusy}
                    onAssign={(a) => onAssign(role.key, a)}
                    onCancel={() => setAssigningRole(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
