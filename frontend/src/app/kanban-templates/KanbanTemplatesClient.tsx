'use client';

/**
 * Kanban Templates — author, switch, publish, and shop team-board templates.
 * Three tabs: My Templates (list + fork + lane/requirement editor + publish/delete),
 * Marketplace (install public templates), and Roles (the job-function taxonomy).
 * The spine of the Agentic Workforce Kanban: each lane declares the roles +
 * diagnostics required before a ticket advances.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { kanbanApi } from '@/lib/builderforceApi';
import { usePermission } from '@/lib/rbac';
import type {
  JobRole, KanbanTemplate, TemplateSummary, TemplateLane, LaneRequirement, RequirementKind, RequirementGate,
} from '@/lib/kanban';

type Tab = 'mine' | 'marketplace' | 'roles';

const card: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 16,
};
const chip = (bg: string, fg: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 999,
  fontSize: 11, fontWeight: 600, background: bg, color: fg,
});
const btn = (primary = false): React.CSSProperties => ({
  fontSize: 12, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
  background: primary ? 'var(--accent, #2563eb)' : 'var(--surface-2)',
  color: primary ? '#fff' : 'var(--text-primary)', border: primary ? 'none' : '1px solid var(--border)',
});
const input: React.CSSProperties = {
  padding: '6px 8px', borderRadius: 6, fontSize: 13, background: 'var(--surface-2)',
  color: 'var(--text-primary)', border: '1px solid var(--border)',
};

export default function KanbanTemplatesClient() {
  const t = useTranslations('kanban');
  const canManage = usePermission('agents.create').allowed;
  const [tab, setTab] = useState<Tab>('mine');
  const [mine, setMine] = useState<TemplateSummary[]>([]);
  const [market, setMarket] = useState<TemplateSummary[]>([]);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [editing, setEditing] = useState<KanbanTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [m, mk, r] = await Promise.all([
        kanbanApi.listTemplates(),
        kanbanApi.listPublicTemplates(),
        kanbanApi.listRoles(),
      ]);
      setMine(m); setMarket(mk); setRoles(r);
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const openEditor = async (id: string) => {
    setError(null);
    try { setEditing(await kanbanApi.getTemplate(id)); }
    catch (e) { setError((e as Error).message); }
  };

  const fork = async (id: string) => {
    setError(null);
    try {
      const src = await kanbanApi.getTemplate(id);
      const created = await kanbanApi.createTemplate({ name: `${src.name} (copy)`, forkFrom: id });
      await reload();
      setEditing(await kanbanApi.getTemplate(created.id));
    } catch (e) { setError((e as Error).message); }
  };

  const remove = async (id: string) => {
    setError(null);
    try { await kanbanApi.deleteTemplate(id); await reload(); }
    catch (e) { setError((e as Error).message); }
  };

  const install = async (id: string) => {
    setError(null);
    try { await kanbanApi.installTemplate(id); await reload(); setTab('mine'); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{t('templatesTitle')}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('templatesSubtitle')}</p>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['mine', 'marketplace', 'roles'] as Tab[]).map((tb) => (
          <button key={tb} type="button" onClick={() => setTab(tb)}
            style={{ ...btn(tab === tb), padding: '6px 14px' }}>
            {t(`tab_${tb}`)}
          </button>
        ))}
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--danger-text, #dc2626)' }}>{error}</div>}

      {editing ? (
        <TemplateEditor
          template={editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={async () => { await reload(); setEditing(null); }}
        />
      ) : tab === 'mine' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {mine.map((tpl) => (
            <div key={tpl.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
                  {tpl.name}
                  {tpl.builtin && <span style={chip('var(--surface-2)', 'var(--text-secondary)')}>{t('builtin')}</span>}
                  {tpl.published && <span style={chip('var(--success-bg, #dcfce7)', 'var(--success-text, #166534)')}>{t('published')}</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('laneRoleCount', { lanes: tpl.laneCount, roles: tpl.roleCount })}
                  {tpl.description ? ` · ${tpl.description}` : ''}
                </div>
              </div>
              {canManage && (tpl.builtin
                ? <button type="button" style={btn()} onClick={() => fork(tpl.id)}>{t('fork')}</button>
                : (
                  <>
                    <button type="button" style={btn(true)} onClick={() => openEditor(tpl.id)}>{t('edit')}</button>
                    <button type="button" style={btn()} onClick={() => remove(tpl.id)}>{t('delete')}</button>
                  </>
                ))}
            </div>
          ))}
        </div>
      ) : tab === 'marketplace' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {market.map((tpl) => (
            <div key={tpl.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600 }}>{tpl.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('laneRoleCount', { lanes: tpl.laneCount, roles: tpl.roleCount })}
                  {' · '}{tpl.priceCents ? `$${(tpl.priceCents / 100).toFixed(2)}` : t('free')}
                  {tpl.installCount ? ` · ${t('installs', { count: tpl.installCount })}` : ''}
                </div>
              </div>
              {canManage && <button type="button" style={btn(true)} onClick={() => install(tpl.id)}>{t('install')}</button>}
            </div>
          ))}
        </div>
      ) : (
        <RolesTab roles={roles} canManage={canManage} onChange={reload} onError={setError} />
      )}
    </div>
  );
}

// ── Roles tab ──────────────────────────────────────────────────────────────────
function RolesTab({ roles, canManage, onChange, onError }: {
  roles: JobRole[]; canManage: boolean; onChange: () => Promise<void>; onError: (e: string) => void;
}) {
  const t = useTranslations('kanban');
  const [name, setName] = useState('');
  const [discipline, setDiscipline] = useState('engineering');

  const add = async () => {
    if (!name.trim()) return;
    try { await kanbanApi.createRole({ name: name.trim(), discipline }); setName(''); await onChange(); }
    catch (e) { onError((e as Error).message); }
  };

  return (
    <div style={card}>
      <div style={{ display: 'grid', gap: 6 }}>
        {roles.map((r) => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: 'var(--surface-2)' }}>
            <span aria-hidden>{r.icon ?? '👤'}</span>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.discipline}</span>
            <span style={{ flex: 1 }} />
            {r.builtin
              ? <span style={chip('var(--surface)', 'var(--text-muted)')}>{t('builtin')}</span>
              : canManage && <button type="button" style={btn()} onClick={async () => { try { await kanbanApi.deleteRole(r.key); await onChange(); } catch (e) { onError((e as Error).message); } }}>{t('delete')}</button>}
          </div>
        ))}
      </div>
      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <input style={{ ...input, flex: '1 1 160px' }} placeholder={t('roleNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
          <select style={input} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
            {['engineering', 'product', 'design', 'qa', 'devops', 'data', 'security', 'other'].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button type="button" style={btn(true)} onClick={add}>{t('addRole')}</button>
        </div>
      )}
    </div>
  );
}

// ── Lane / requirement editor ───────────────────────────────────────────────────
function TemplateEditor({ template, roles, onClose, onSaved }: {
  template: KanbanTemplate; roles: JobRole[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const t = useTranslations('kanban');
  const [name, setName] = useState(template.name);
  const [lanes, setLanes] = useState<TemplateLane[]>(template.lanes);
  const [saving, setSaving] = useState(false);
  const [priceUsd, setPriceUsd] = useState(template.priceCents ? String(template.priceCents / 100) : '');
  const [err, setErr] = useState<string | null>(null);

  const updateLane = (i: number, patch: Partial<TemplateLane>) =>
    setLanes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const updateReq = (li: number, ri: number, patch: Partial<LaneRequirement>) =>
    setLanes((ls) => ls.map((l, j) => (j === li ? { ...l, requirements: l.requirements.map((r, k) => (k === ri ? { ...r, ...patch } : r)) } : l)));
  const addReq = (li: number) =>
    setLanes((ls) => ls.map((l, j) => (j === li ? { ...l, requirements: [...l.requirements, { kind: 'review' as RequirementKind, ref: roles[0]?.key ?? 'developer', responsibility: 'reviewer', isRequired: true, position: l.requirements.length }] } : l)));
  const removeReq = (li: number, ri: number) =>
    setLanes((ls) => ls.map((l, j) => (j === li ? { ...l, requirements: l.requirements.filter((_, k) => k !== ri) } : l)));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const priceCents = priceUsd.trim() ? Math.round(parseFloat(priceUsd) * 100) : null;
      await kanbanApi.updateTemplate(template.id, { name, lanes, priceCents });
      await onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };

  const publish = async (published: boolean) => {
    setErr(null);
    try {
      const priceCents = priceUsd.trim() ? Math.round(parseFloat(priceUsd) * 100) : null;
      await kanbanApi.publishTemplate(template.id, { published, visibility: 'public', priceCents });
      await onSaved();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" style={btn()} onClick={onClose}>← {t('back')}</button>
        <input style={{ ...input, flex: '1 1 200px', fontWeight: 600 }} value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" style={btn(true)} disabled={saving} onClick={save}>{saving ? t('saving') : t('save')}</button>
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--danger-text, #dc2626)', marginBottom: 8 }}>{err}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {lanes.map((lane, li) => (
          <div key={lane.key} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <input style={{ ...input, flex: '1 1 140px', fontWeight: 600 }} value={lane.name} onChange={(e) => updateLane(li, { name: e.target.value })} />
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('gate')}</label>
              <select style={input} value={lane.gate} onChange={(e) => updateLane(li, { gate: e.target.value as TemplateLane['gate'] })}>
                <option value="auto">{t('gateAuto')}</option>
                <option value="human">{t('gateHuman')}</option>
              </select>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('requirementGate')}</label>
              <select style={input} value={lane.requirementGate} onChange={(e) => updateLane(li, { requirementGate: e.target.value as RequirementGate })}>
                <option value="off">{t('gateOff')}</option>
                <option value="soft">{t('gateSoft')}</option>
                <option value="hard">{t('gateHard')}</option>
              </select>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {lane.requirements.map((req, ri) => (
                <div key={ri} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                  <select style={input} value={req.kind} onChange={(e) => updateReq(li, ri, { kind: e.target.value as RequirementKind })}>
                    <option value="role">{t('kindRole')}</option>
                    <option value="review">{t('kindReview')}</option>
                    <option value="diagnostic">{t('kindDiagnostic')}</option>
                  </select>
                  {req.kind === 'diagnostic' ? (
                    <input style={{ ...input, flex: '1 1 140px' }} placeholder="diagnostic id" value={req.ref} onChange={(e) => updateReq(li, ri, { ref: e.target.value })} />
                  ) : (
                    <select style={input} value={req.ref} onChange={(e) => updateReq(li, ri, { ref: e.target.value })}>
                      {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                    </select>
                  )}
                  {req.kind !== 'diagnostic' && (
                    <select style={input} value={req.responsibility ?? 'reviewer'} onChange={(e) => updateReq(li, ri, { responsibility: e.target.value as LaneRequirement['responsibility'] })}>
                      <option value="owner">{t('respOwner')}</option>
                      <option value="reviewer">{t('respReviewer')}</option>
                      <option value="contributor">{t('respContributor')}</option>
                    </select>
                  )}
                  <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={req.isRequired} onChange={(e) => updateReq(li, ri, { isRequired: e.target.checked })} />
                    {t('required')}
                  </label>
                  <button type="button" style={btn()} onClick={() => removeReq(li, ri)}>✕</button>
                </div>
              ))}
              <button type="button" style={{ ...btn(), width: 'fit-content' }} onClick={() => addReq(li)}>+ {t('addRequirement')}</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('priceLabel')}</label>
        <input style={{ ...input, width: 90 }} placeholder="0.00" value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} />
        {template.published
          ? <button type="button" style={btn()} onClick={() => publish(false)}>{t('unpublish')}</button>
          : <button type="button" style={btn(true)} onClick={() => publish(true)}>{t('publishToMarketplace')}</button>}
      </div>
    </div>
  );
}
