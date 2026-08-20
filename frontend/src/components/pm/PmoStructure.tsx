'use client';

import { useMemo, useRef, useState } from 'react';
import { Select } from '@/components/Select';
import { useTranslations } from 'next-intl';
import {
  pmoApi,
  type PmoTree,
  type PmoRollup as PmoRollupData,
  type ObjectiveProgress,
  type SpineResult,
} from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmError, PmEmpty, StatusPill, FocusTarget } from './pmShared';
import { pmoFocusDomId } from '@seanhogg/builderforce-brain-embedded';
import { ObjectiveCard } from './ObjectiveCard';
import { useConfirm } from '@/components/ConfirmProvider';
import { windowState, windowStateLabelKey } from '@/lib/pm/planning';

/**
 * PMO management surface — the single place portfolios, initiatives, projects AND
 * OKR objectives live together (the OKRs tab was merged in so an objective sits
 * under the portfolio that owns it, not on a separate screen). Assign anything by
 * drag-and-drop OR the inline dropdown (both call the same handler): drop an
 * initiative or an objective onto a portfolio card to reassign it, or onto the
 * Unassigned card to detach it. All mutations are manager-gated server-side; the
 * whole PMO page is wrapped in <RoleGate capability="insights.portfolio">. Fully
 * localized; theme-token styled; drag-and-drop is a progressive enhancement over
 * the always-present dropdowns (the accessible / touch path).
 */
const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.85rem',
};
const btnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--accent)',
  color: 'var(--text-on-accent)', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap',
};
const ghostBtn: React.CSSProperties = {
  ...btnStyle, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
};
const dangerBtn: React.CSSProperties = {
  ...btnStyle, background: 'transparent', color: 'var(--error-text)', border: '1px solid var(--border-subtle)',
};
/** A required window field. `colorScheme` keeps the native picker legible in BOTH themes. */
const dateInputStyle: React.CSSProperties = {
  ...inputStyle, flex: 'none', minWidth: 132, colorScheme: 'light dark',
};

const WS_ZONE = '__ws__'; // drop-zone key for the Unassigned / org-level bucket
type DragItem = { kind: 'initiative' | 'objective'; id: string };

/** The ONE card a deep-link named, if any — see `artifactRoutePath`. */
export interface PmoFocus { kind: 'objective' | 'initiative' | 'portfolio'; id: string }

export function PmoStructure({ tree, onChange, focus }: { tree: PmoTree; onChange: () => void; focus?: PmoFocus | null }) {
  /** True for the one card the URL points at, so exactly one ring can be lit. */
  const isFocused = (kind: PmoFocus['kind'], id: string) => focus?.kind === kind && focus.id === id;
  const t = useTranslations('pmo');
  const tPlanning = useTranslations('planning');
  const confirm = useConfirm();
  // Objectives (with progress + KRs + links + owner) come from the workspace rollup
  // — that scope returns EVERY objective, which we group under its portfolio below.
  const { data: rollup, error: objectivesError, reload: reloadObjectives } = usePmData<PmoRollupData>(() => pmoApi.rollup('workspace', 'workspace'), []);
  const { data: spine } = usePmData<SpineResult>(() => pmoApi.spine(), []);
  // usePmData nulls `data` while a reload is in flight; keep the last-good objectives
  // so a mutation (drag / dropdown) doesn't blank the list mid-update.
  const lastObjectives = useRef<ObjectiveProgress[]>([]);
  const objectives = useMemo(() => {
    if (rollup) lastObjectives.current = rollup.okr.objectives;
    return lastObjectives.current;
  }, [rollup]);
  const epics = useMemo(() => (spine?.nodes ?? []).filter((n) => n.kind === 'epic'), [spine]);
  const looseTasks = useMemo(() => (spine?.nodes ?? []).filter((n) => n.kind === 'task'), [spine]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newPortfolio, setNewPortfolio] = useState('');
  const [newInitiative, setNewInitiative] = useState<Record<string, string>>({});
  const [newObjective, setNewObjective] = useState<Record<string, string>>({}); // key: portfolioId | WS_ZONE
  // A container's WINDOW is now required at creation (SCHED-R2). Deriving one from
  // descendants covers the populated case, but a brand-new objective/initiative has
  // no descendants, so it used to land on the spine permanently undated and nobody
  // was ever asked when it was meant to happen. The server rejects a create without
  // them; asking here means the user finds out before they press the button.
  const [newObjectiveDates, setNewObjectiveDates] = useState<Record<string, { start: string; end: string }>>({});
  const [newInitiativeDates, setNewInitiativeDates] = useState<Record<string, { start: string; end: string }>>({});
  // Drag-and-drop: the item being dragged + the drop-zone under the pointer.
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [dropZone, setDropZone] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try { await fn(); onChange(); reloadObjectives(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const initiativeName = (id: string) => tree.initiatives.find((i) => i.id === id)?.name ?? id;
  const portfolioOfInitiative = (initiativeId: string | null): string | null =>
    (initiativeId ? tree.initiatives.find((i) => i.id === initiativeId)?.portfolioId ?? null : null);
  const initiativesByPortfolio = (portfolioId: string | null) =>
    tree.initiatives.filter((i) => (i.portfolioId ?? null) === portfolioId);
  const projectsByInitiative = (initiativeId: string) =>
    tree.projects.filter((p) => p.initiativeId === initiativeId);
  const unlinkedProjects = tree.projects.filter((p) => p.initiativeId == null);
  const blockersOf = (initiativeId: string) => tree.dependencies.filter((d) => d.toInitiativeId === initiativeId);
  // An objective belongs to a portfolio if attached directly OR via one of the
  // portfolio's initiatives; the rest (org-level / project-scoped / under an
  // unassigned initiative) fall into the Unassigned bucket.
  const objectivesByPortfolio = (portfolioId: string) =>
    objectives.filter((o) => o.portfolioId === portfolioId || portfolioOfInitiative(o.initiativeId) === portfolioId);
  const unassignedObjectives = objectives.filter(
    (o) => !o.portfolioId && portfolioOfInitiative(o.initiativeId) === null,
  );

  // ── Shared assignment handlers (drag-drop AND dropdowns call these) ─────────
  const moveInitiative = (id: string, portfolioId: string | null) => {
    if ((tree.initiatives.find((i) => i.id === id)?.portfolioId ?? null) === portfolioId) return;
    run(() => pmoApi.initiatives.update(id, { portfolioId }));
  };
  const moveObjective = (id: string, portfolioId: string | null) => {
    const o = objectives.find((x) => x.id === id);
    if (o && (o.portfolioId ?? null) === portfolioId && !o.initiativeId && o.projectId == null) return;
    run(() => pmoApi.objectives.update(id, { portfolioId, initiativeId: null, projectId: null }));
  };
  const objectiveDates = (ownerKey: string) => newObjectiveDates[ownerKey] ?? { start: '', end: '' };
  const initiativeDates = (portfolioId: string) => newInitiativeDates[portfolioId] ?? { start: '', end: '' };
  const objectiveReady = (ownerKey: string) => {
    const d = objectiveDates(ownerKey);
    return !!(newObjective[ownerKey] ?? '').trim() && !!d.start && !!d.end;
  };
  const initiativeReady = (portfolioId: string) => {
    const d = initiativeDates(portfolioId);
    return !!(newInitiative[portfolioId] ?? '').trim() && !!d.start && !!d.end;
  };

  const createObjective = (ownerKey: string) => {
    const title = (newObjective[ownerKey] ?? '').trim();
    const dates = objectiveDates(ownerKey);
    if (!title || !dates.start || !dates.end) return;
    run(async () => {
      await pmoApi.objectives.create({
        title,
        startDate: dates.start,
        endDate: dates.end,
        ...(ownerKey === WS_ZONE ? {} : { portfolioId: ownerKey }),
      });
      setNewObjective((s) => ({ ...s, [ownerKey]: '' }));
      setNewObjectiveDates((s) => ({ ...s, [ownerKey]: { start: '', end: '' } }));
    });
  };

  /** Drop-zone props for a portfolio card (portfolioId=null → Unassigned zone).
   *  Accepts BOTH a dragged initiative and a dragged objective. */
  const dropZoneProps = (portfolioId: string | null) => {
    const zoneKey = portfolioId ?? WS_ZONE;
    const active = drag != null && dropZone === zoneKey;
    return {
      onDragOver: (e: React.DragEvent) => { if (drag != null) { e.preventDefault(); setDropZone(zoneKey); } },
      onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropZone((z) => (z === zoneKey ? null : z)); },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (drag?.kind === 'initiative') moveInitiative(drag.id, portfolioId);
        else if (drag?.kind === 'objective') moveObjective(drag.id, portfolioId);
        setDrag(null); setDropZone(null);
      },
      style: active ? { outline: '2px dashed var(--accent)', outlineOffset: 2, borderRadius: 'var(--radius-lg)' } : undefined,
    };
  };

  const renderInitiative = (init: PmoTree['initiatives'][number]) => {
    const linked = projectsByInitiative(init.id);
    const blockers = blockersOf(init.id);
    const blockerIds = new Set(blockers.map((b) => b.fromInitiativeId));
    const candidates = tree.initiatives.filter((i) => i.id !== init.id && !blockerIds.has(i.id));
    const dragging = drag?.kind === 'initiative' && drag.id === init.id;
    return (
      <FocusTarget key={init.id} id={pmoFocusDomId('initiative', init.id)} active={isFocused('initiative', init.id)}>
      <div
        draggable={!busy}
        onDragStart={(e) => { setDrag({ kind: 'initiative', id: init.id }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', init.id); }}
        onDragEnd={() => { setDrag(null); setDropZone(null); }}
        style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 12, marginTop: 10, opacity: dragging ? 0.5 : 1, cursor: busy ? 'default' : 'grab' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden="true" title={t('structure.dragHint')} style={{ color: 'var(--text-muted)', cursor: busy ? 'default' : 'grab', userSelect: 'none' }}>⠿</span>
            {init.name}
          </strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Select
              disabled={busy}
              value={init.portfolioId ?? ''}
              title={t('structure.movePortfolio')}
              onChange={(e) => moveInitiative(init.id, e.target.value || null)}
              style={{ ...inputStyle, flex: 'none', minWidth: 170 }}
            >
              <option value="">{t('structure.unassignedOption')}</option>
              {tree.portfolios.map((pf) => <option key={pf.id} value={pf.id}>{pf.name}</option>)}
            </Select>
            {/* The initiative's own WINDOW. Dates are required at creation now, so a
                row with none is a legacy initiative waiting to be scoped — said
                explicitly rather than left blank, which read as "no opinion". */}
            {(() => {
              // The tree read carries the initiative's TARGET date; an initiative with
              // no target has no window at all, since both ends are required together.
              const emptyKey = windowStateLabelKey(windowState({
                kind: 'initiative', startDate: null, endDate: init.targetDate ?? null,
              }));
              return (
                <span
                  style={{
                    fontSize: '0.74rem',
                    color: emptyKey === 'not-yet-scoped' ? 'var(--warning-text, var(--warning))' : 'var(--text-muted)',
                    fontStyle: emptyKey ? 'italic' : undefined,
                  }}
                  title={emptyKey === 'not-yet-scoped' ? tPlanning('notYetScopedTitle') : undefined}
                >
                  {emptyKey ? tPlanning(emptyKey) : `→ ${(init.targetDate ?? '').slice(0, 10)}`}
                </span>
              );
            })()}
            <StatusPill value={init.status} />
            <button type="button" disabled={busy} style={dangerBtn}
              onClick={async () => { if (await confirm(t('structure.confirmDeleteInitiative'))) run(() => pmoApi.initiatives.remove(init.id)); }}>
              {t('structure.delete')}
            </button>
          </div>
        </div>

        {/* Linked projects */}
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {linked.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('structure.noProjectsLinked')}</span>}
          {linked.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: '0.83rem' }}>
              <span>{p.key} · {p.name}</span>
              <button type="button" disabled={busy} onClick={() => run(() => pmoApi.linkProject(p.id, null))} style={ghostBtn}>
                {t('structure.unlink')}
              </button>
            </div>
          ))}
        </div>
        {unlinkedProjects.length > 0 && (
          <Select
            disabled={busy}
            defaultValue=""
            onChange={(e) => { const pid = Number(e.target.value); if (pid) run(() => pmoApi.linkProject(pid, init.id)); }}
            style={{ ...inputStyle, marginTop: 8, width: '100%' }}
          >
            <option value="">{t('structure.linkProject')}</option>
            {unlinkedProjects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
          </Select>
        )}

        {/* Dependencies (blocked by) */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border-subtle)' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('structure.dependsOn')}</div>
          {blockers.map((b) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: '0.82rem', marginBottom: 4 }}>
              <span>{initiativeName(b.fromInitiativeId)}</span>
              <button type="button" disabled={busy} onClick={() => run(() => pmoApi.removeDependency(b.id))} style={ghostBtn}>
                {t('structure.remove')}
              </button>
            </div>
          ))}
          {candidates.length > 0 && (
            <Select
              disabled={busy}
              defaultValue=""
              onChange={(e) => { const fromId = e.target.value; if (fromId) run(() => pmoApi.addDependency(fromId, init.id)); }}
              style={{ ...inputStyle, marginTop: 4, width: '100%' }}
            >
              <option value="">{t('structure.addDependency')}</option>
              {candidates.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
          )}
        </div>
      </div>
      </FocusTarget>
    );
  };

  const renderObjective = (o: ObjectiveProgress) => (
    <FocusTarget key={o.id} id={pmoFocusDomId('objective', o.id)} active={isFocused('objective', o.id)}>
    <ObjectiveCard
      o={o}
      busy={busy}
      run={run}
      portfolios={tree.portfolios}
      initiatives={tree.initiatives}
      projects={tree.projects}
      epics={epics}
      looseTasks={looseTasks}
      dragging={drag?.kind === 'objective' && drag.id === o.id}
      onDragStart={() => setDrag({ kind: 'objective', id: o.id })}
      onDragEnd={() => { setDrag(null); setDropZone(null); }}
    />
    </FocusTarget>
  );

  /** The "＋ objective" inline creator for a given owner bucket. Both dates are
   *  required — see `newObjectiveDates`. */
  const newObjectiveRow = (ownerKey: string) => (
    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <input
        style={{ ...inputStyle, minWidth: 180 }}
        placeholder={t('okr.objectivePlaceholder')}
        value={newObjective[ownerKey] ?? ''}
        onChange={(e) => setNewObjective((s) => ({ ...s, [ownerKey]: e.target.value }))}
        onKeyDown={(e) => { if (e.key === 'Enter') createObjective(ownerKey); }}
      />
      <input
        type="date"
        required
        aria-label={tPlanning('startDateRequired')}
        title={tPlanning('startDateRequired')}
        style={dateInputStyle}
        value={objectiveDates(ownerKey).start}
        onChange={(e) => setNewObjectiveDates((s) => ({ ...s, [ownerKey]: { ...objectiveDates(ownerKey), start: e.target.value } }))}
      />
      <input
        type="date"
        required
        aria-label={tPlanning('endDateRequired')}
        title={tPlanning('endDateRequired')}
        style={dateInputStyle}
        value={objectiveDates(ownerKey).end}
        onChange={(e) => setNewObjectiveDates((s) => ({ ...s, [ownerKey]: { ...objectiveDates(ownerKey), end: e.target.value } }))}
      />
      <button type="button" style={ghostBtn} disabled={busy || !objectiveReady(ownerKey)} onClick={() => createObjective(ownerKey)}>
        {t('okr.newObjective')}
      </button>
      {!objectiveReady(ownerKey) && (newObjective[ownerKey] ?? '').trim() && (
        <span style={{ fontSize: '0.75rem', color: 'var(--warning-text, var(--warning))' }}>{tPlanning('windowRequired')}</span>
      )}
    </div>
  );

  const sectionLabel = (text: string) => (
    <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', margin: '18px 0 4px' }}>{text}</div>
  );

  // First-ever load (no cached objectives yet, none arrived): show a light gate.
  if (rollup == null && lastObjectives.current.length === 0 && !objectivesError) return <PmEmpty message={t('loading')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {(err || objectivesError) && <PmError message={err ?? objectivesError!} />}

      <PmCard
        title={t('structure.newPortfolio')}
        action={
          <div style={{ display: 'flex', gap: 8, minWidth: 320 }}>
            <input style={inputStyle} placeholder={t('structure.portfolioName')} value={newPortfolio} onChange={(e) => setNewPortfolio(e.target.value)} />
            <button type="button" style={btnStyle} disabled={busy || !newPortfolio.trim()}
              onClick={() => run(async () => { await pmoApi.portfolios.create({ name: newPortfolio.trim() }); setNewPortfolio(''); })}>
              {t('structure.create')}
            </button>
          </div>
        }
      >
        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{t('structure.portfolioHint')}</span>
      </PmCard>

      {tree.portfolios.length === 0 && (
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('structure.noPortfolios')}</span>
      )}

      {tree.portfolios.map((pf) => {
        const inits = initiativesByPortfolio(pf.id);
        const objs = objectivesByPortfolio(pf.id);
        return (
          <FocusTarget key={pf.id} id={pmoFocusDomId('portfolio', pf.id)} active={isFocused('portfolio', pf.id)}>
          <div {...dropZoneProps(pf.id)}>
            <PmCard
              title={pf.name}
              action={
                <div style={{ display: 'flex', gap: 8, minWidth: 360, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    style={{ ...inputStyle, minWidth: 160 }}
                    placeholder={t('structure.newInitiativeName')}
                    value={newInitiative[pf.id] ?? ''}
                    onChange={(e) => setNewInitiative((s) => ({ ...s, [pf.id]: e.target.value }))}
                  />
                  {/* Both ends are required — an initiative with no window is what put
                      permanently-unscoped rows on the planning spine. */}
                  <input
                    type="date"
                    required
                    aria-label={tPlanning('startDateRequired')}
                    title={tPlanning('startDateRequired')}
                    style={dateInputStyle}
                    value={initiativeDates(pf.id).start}
                    onChange={(e) => setNewInitiativeDates((s) => ({ ...s, [pf.id]: { ...initiativeDates(pf.id), start: e.target.value } }))}
                  />
                  <input
                    type="date"
                    required
                    aria-label={tPlanning('targetDateRequired')}
                    title={tPlanning('targetDateRequired')}
                    style={dateInputStyle}
                    value={initiativeDates(pf.id).end}
                    onChange={(e) => setNewInitiativeDates((s) => ({ ...s, [pf.id]: { ...initiativeDates(pf.id), end: e.target.value } }))}
                  />
                  <button type="button" style={btnStyle} disabled={busy || !initiativeReady(pf.id)}
                    onClick={() => run(async () => {
                      await pmoApi.initiatives.create({
                        name: (newInitiative[pf.id] ?? '').trim(),
                        portfolioId: pf.id,
                        startDate: initiativeDates(pf.id).start,
                        targetDate: initiativeDates(pf.id).end,
                      });
                      setNewInitiative((s) => ({ ...s, [pf.id]: '' }));
                      setNewInitiativeDates((s) => ({ ...s, [pf.id]: { start: '', end: '' } }));
                    })}>
                    {t('structure.addInitiative')}
                  </button>
                  {!initiativeReady(pf.id) && (newInitiative[pf.id] ?? '').trim() && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--warning-text, var(--warning))' }}>{tPlanning('windowRequired')}</span>
                  )}
                  <button type="button" style={dangerBtn} disabled={busy}
                    onClick={async () => { if (await confirm(t('structure.confirmDeletePortfolio'))) run(() => pmoApi.portfolios.remove(pf.id)); }}>
                    {t('structure.delete')}
                  </button>
                </div>
              }
            >
              {sectionLabel(t('section.initiatives'))}
              {inits.length === 0
                ? <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{drag?.kind === 'initiative' ? t('structure.dropHere') : t('structure.noInitiatives')}</span>
                : inits.map(renderInitiative)}

              {sectionLabel(t('section.objectives'))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {objs.length === 0
                  ? <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{drag?.kind === 'objective' ? t('structure.dropObjectiveHere') : t('okr.noObjectives')}</span>
                  : objs.map(renderObjective)}
              </div>
              {newObjectiveRow(pf.id)}
            </PmCard>
          </div>
          </FocusTarget>
        );
      })}

      {/* Unassigned: initiatives with no portfolio + org-level / project-scoped objectives. */}
      {(initiativesByPortfolio(null).length > 0 || unassignedObjectives.length > 0 || drag != null) && (
        <div {...dropZoneProps(null)}>
          <PmCard title={t('structure.unassigned')}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{t('structure.unassignedHint')}</span>

            {sectionLabel(t('section.initiatives'))}
            {initiativesByPortfolio(null).length > 0
              ? initiativesByPortfolio(null).map(renderInitiative)
              : <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{drag?.kind === 'initiative' ? t('structure.dropHere') : t('structure.noInitiatives')}</span>}

            {sectionLabel(t('section.objectives'))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {unassignedObjectives.length > 0
                ? unassignedObjectives.map(renderObjective)
                : <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{drag?.kind === 'objective' ? t('structure.dropObjectiveHere') : t('okr.noObjectives')}</span>}
            </div>
            {newObjectiveRow(WS_ZONE)}
          </PmCard>
        </div>
      )}
    </div>
  );
}
