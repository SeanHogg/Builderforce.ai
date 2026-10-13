/**
 * The pieces of a fix card's actions that are not buttons (PRD 33 §5.1.4, §5.2):
 * the "Apply to the page" audience gate and what an action's answer says to the
 * reader. `PrescriptionActions` composes them.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImprovementAudience, ReplayPrescriptionActionResultDto } from '@builderforce/interaction-contract';
import { AudienceSwitch } from '../prompt/AudienceSwitch';
import type { PrescriptionActionGate } from './prescriptionActionUi';

/** A `replay.prescription.result` key + its values. */
export interface ActionNote {
  key: string;
  values: Record<string, string | number>;
}

/** What an action's answer says to the reader. */
export function actionResultNote(result: ReplayPrescriptionActionResultDto, gate: PrescriptionActionGate): ActionNote {
  if (result.refusal) return { key: 'refusal', values: { reason: result.refusal } };
  if (result.executionId != null) return { key: 'run', values: { taskId: result.taskId ?? '' } };
  if (result.taskId != null) return { key: 'ticket', values: { taskId: result.taskId } };
  if (result.testId != null) return { key: 'test', values: { testId: result.testId } };
  if (result.followUp?.createdSequence) {
    return { key: 'sequenceCreated', values: { name: result.followUp.createdSequence.name, count: result.followUp.enrolled } };
  }
  if (result.followUp && result.followUp.enrolled > 0) return { key: 'enrolled', values: { count: result.followUp.enrolled } };
  if (gate === 'composer' && result.prompt) return { key: 'composer', values: {} };
  if (gate === 'audience' && result.prescriptionIds) return { key: 'page', values: { count: result.prescriptionIds.length } };
  return { key: 'done', values: {} };
}

export interface ApplyPageGateProps {
  busy: boolean;
  onApply: (audience: ImprovementAudience) => void;
  onCancel: () => void;
}

/** Who the page's ONE prompt is for, then apply (every accepted fix on the page is bundled and marked applied). */
export function ApplyPageGate({ busy, onApply, onCancel }: ApplyPageGateProps) {
  const t = useTranslations('replay.prescription.applyPage');
  const [audience, setAudience] = useState<ImprovementAudience>('coding_agent');
  return (
    <form
      aria-label={t('title')}
      onSubmit={(event) => { event.preventDefault(); onApply(audience); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface)' }}
    >
      <strong style={{ fontSize: 'var(--font-size-small)' }}>{t('title')}</strong>
      <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('body')}</p>
      <AudienceSwitch value={audience} onChange={setAudience} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <button type="submit" className="btn-primary" disabled={busy} style={{ minHeight: 44 }}>{t('submit')}</button>
        <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={onCancel}>{t('cancel')}</button>
      </div>
    </form>
  );
}
