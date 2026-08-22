'use client';

/**
 * What a lane DOES when a card lands in it — run a workflow, or nothing.
 *
 * Its own file because the choice is a lane's behaviour rather than its shape: the
 * lanes tab lists lanes; this row is the one place that says what entering one
 * costs.
 */
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { LaneRunNowButton } from '../LaneRunNowButton';
import type { Swimlane, WorkflowDefinitionSummary } from '@/lib/builderforceApi';
import { inputStyle } from './configStyles';

export function LaneActionRow({ lane, lanes, workflows, patchLane }: {
  lane: Swimlane;
  lanes: Swimlane[];
  workflows: WorkflowDefinitionSummary[];
  patchLane: (id: string, body: Record<string, unknown>) => void;
}) {
  const t = useTranslations('boardConfig');
  const actionType = lane.actionType ?? 'advance';
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
      <span style={labelStyle}>{t('whenDone')}</span>
      <Select
        value={actionType}
        onChange={(e) => patchLane(lane.id, { actionType: e.target.value, actionTarget: '' })}
        style={inputStyle}
        title={t('whenDoneTitle')}
      >
        <option value="advance">{t('actionAdvance')}</option>
        <option value="move_ticket">{t('actionMoveTicket')}</option>
        <option value="run_workflow">{t('actionRunWorkflow')}</option>
        <option value="do_nothing">{t('actionDoNothing')}</option>
      </Select>
      {actionType === 'move_ticket' && (
        <Select value={lane.actionTarget ?? ''} onChange={(e) => patchLane(lane.id, { actionTarget: e.target.value })} style={inputStyle} title={t('destinationLane')}>
          <option value="">{t('selectLane')}</option>
          {lanes.filter((l) => l.id !== lane.id).map((l) => <option key={l.id} value={l.key}>{l.name}</option>)}
        </Select>
      )}
      {actionType === 'run_workflow' && (
        <Select value={lane.actionTarget ?? ''} onChange={(e) => patchLane(lane.id, { actionTarget: e.target.value })} style={inputStyle} title={t('workflowToRun')}>
          <option value="">{t('selectWorkflow')}</option>
          {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      )}
      <span style={{ width: 1, height: 18, background: 'var(--border-subtle)' }} />
      <span style={labelStyle}>{t('succeedsWhen')}</span>
      <Select
        value={lane.successPolicy ?? 'all'}
        onChange={(e) => patchLane(lane.id, { successPolicy: e.target.value, ...(e.target.value === 'n_of_m' ? {} : { successThreshold: null }) })}
        style={inputStyle}
        title={t('succeedsWhenTitle')}
      >
        <option value="all">{t('successAll')}</option>
        <option value="any">{t('successAny')}</option>
        <option value="n_of_m">{t('successNofM')}</option>
      </Select>
      {lane.successPolicy === 'n_of_m' && (
        <input
          type="number" min={1} style={{ ...inputStyle, width: 64 }} defaultValue={lane.successThreshold ?? 1}
          onBlur={(e) => patchLane(lane.id, { successThreshold: Math.max(1, Number(e.target.value) || 1) })} title={t('nLabel')}
        />
      )}
    </div>
  );
}

/** Per-lane role/diagnostic/review requirements — editable live (no template re-apply).
 *  Requirements are lazily loaded when the section is expanded to avoid an N+1 across
 *  all lanes. The `requirement_gate` control lives here too so gating strictness and the
 *  checks it enforces are configured in one place. */
