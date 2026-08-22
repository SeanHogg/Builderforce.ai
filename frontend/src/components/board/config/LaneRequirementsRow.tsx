'use client';

/**
 * What a card must satisfy before it may ENTER a lane.
 *
 * A requirement is a gate, and a gate is the one thing on this panel that can stop
 * work rather than shape it — so it gets its own file and its own vocabulary
 * instead of being another row in the lane list.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { boardsApi, type Board, type Swimlane, type SwimlaneRequirement } from '@/lib/builderforceApi';
import { btnPrimary, btnSubtle, inputStyle } from './configStyles';

export function LaneRequirementsRow({ board, lane, patchLane }: {
  board: Board; lane: Swimlane; patchLane: (id: string, body: Record<string, unknown>) => void;
}) {
  const t = useTranslations('boardConfig');
  const [open, setOpen] = useState(false);
  const [reqs, setReqs] = useState<SwimlaneRequirement[] | null>(null);
  const [kind, setKind] = useState<SwimlaneRequirement['kind']>('role');
  const [ref, setRef] = useState('');
  const [responsibility, setResponsibility] = useState<'owner' | 'reviewer' | 'contributor'>('reviewer');

  const load = useCallback(() => {
    boardsApi.requirements.list(board.id, lane.id).then(setReqs).catch(() => setReqs([]));
  }, [board.id, lane.id]);
  useEffect(() => { if (open && reqs === null) load(); }, [open, reqs, load]);

  const add = async () => {
    const r = ref.trim();
    if (!r) return;
    await boardsApi.requirements.create(board.id, lane.id, {
      kind, ref: r, responsibility: kind === 'diagnostic' ? null : responsibility, isRequired: true, position: reqs?.length ?? 0,
    });
    setRef(''); load();
  };
  const remove = async (id: string) => { await boardsApi.requirements.remove(board.id, lane.id, id); load(); };
  const toggleRequired = async (r: SwimlaneRequirement) => { await boardsApi.requirements.patch(board.id, lane.id, r.id, { isRequired: !r.isRequired }); load(); };

  const kindLabel = (k: SwimlaneRequirement['kind']) => t(k === 'role' ? 'reqKindRole' : k === 'diagnostic' ? 'reqKindDiagnostic' : 'reqKindReview');

  return (
    <div style={{ marginTop: 10, borderTop: '1px dashed var(--border-subtle)', paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" style={{ ...btnSubtle }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? '▾' : '▸'} {t('requirements')}
        </button>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}>
          {t('requirementGate')}
          <Select value={lane.requirementGate ?? 'soft'} onChange={(e) => patchLane(lane.id, { requirementGate: e.target.value })} style={inputStyle} title={t('requirementGateTitle')}>
            <option value="off">{t('gateOff')}</option>
            <option value="soft">{t('gateSoft')}</option>
            <option value="hard">{t('gateHard')}</option>
          </Select>
        </label>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t('requirementsIntro')}</div>
          {reqs === null ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('loading')}</div>
          ) : reqs.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noRequirements')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
              {reqs.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '6px 10px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{kindLabel(r.kind)}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{r.ref}</span>
                  {r.responsibility && <span style={{ color: 'var(--text-muted)' }}>· {t(r.responsibility === 'owner' ? 'respOwner' : r.responsibility === 'reviewer' ? 'respReviewer' : 'respContributor')}</span>}
                  <label style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', color: 'var(--text-secondary)' }}>
                    <input type="checkbox" checked={r.isRequired} onChange={() => toggleRequired(r)} /> {t('required')}
                  </label>
                  <button type="button" style={{ ...btnSubtle, color: 'var(--danger)', padding: '2px 8px' }} onClick={() => remove(r.id)}>{t('delete')}</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as SwimlaneRequirement['kind'])} style={inputStyle} title={t('reqKind')}>
              <option value="role">{t('reqKindRole')}</option>
              <option value="review">{t('reqKindReview')}</option>
              <option value="diagnostic">{t('reqKindDiagnostic')}</option>
            </Select>
            <input style={{ ...inputStyle, flex: 1, minWidth: 120 }} placeholder={t('reqRefPlaceholder')} value={ref} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            {kind !== 'diagnostic' && (
              <Select value={responsibility} onChange={(e) => setResponsibility(e.target.value as 'owner' | 'reviewer' | 'contributor')} style={inputStyle} title={t('responsibility')}>
                <option value="reviewer">{t('respReviewer')}</option>
                <option value="owner">{t('respOwner')}</option>
                <option value="contributor">{t('respContributor')}</option>
              </Select>
            )}
            <button type="button" style={btnPrimary} onClick={add}>{t('addRequirement')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
