/**
 * Create or edit a funnel (PRD 33 §2.1 "Funnels"): a name, the window a visit
 * has to finish it in, and 2..10 ordered steps — each a page, a click or a
 * named event, with a match and a mode, and a live "≈ N recordings" preview
 * (`RulePreview`, the smart-event preview: a funnel step IS a rule). Saves with
 * POST (new) or PUT (a whole replacement); delete asks first (`useConfirm`).
 *
 * A LEVEL of the ONE Insights panel (D16: no second overlay): the `funnel_edit`
 * kind (`FunnelEditKind`) renders this body under the breadcrumb back to the
 * funnel it was opened from.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayFunnelDto, ReplayFunnelInput, ReplayFunnelStepKind, ReplayMatchMode } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useConfirm } from '@/components/ConfirmProvider';
import { useErrorText } from '@/i18n/useErrorMessage';
import { Icon } from '@/components/ui/Icon';
import { FUNNEL_STEP_KINDS, MATCH_MODES, STEP_RULE_KIND } from './funnelLevel';
import { RulePreview } from './RulePreview';

export const FUNNEL_MIN_STEPS = 2;
export const FUNNEL_MAX_STEPS = 10;
const DEFAULT_WINDOW_MINUTES = 60;

type StepDraft = ReplayFunnelInput['steps'][number];

export interface FunnelEditorProps {
  siteId: string;
  days: number;
  /** null = a new funnel. */
  funnel: ReplayFunnelDto | null;
  onClose: () => void;
  onSaved: (funnel: ReplayFunnelDto) => void;
  onDeleted?: (funnelId: string) => void;
}

const blankStep = (): StepDraft => ({ stepKind: 'page', match: '', matchMode: 'equals' });

export function FunnelEditor({ siteId, days, funnel, onClose, onSaved, onDeleted }: FunnelEditorProps) {
  const t = useTranslations('replay.funnels');
  const tEvents = useTranslations('replay.smartEvents');
  const confirm = useConfirm();
  const errorText = useErrorText();
  const [name, setName] = useState(funnel?.name ?? '');
  const [windowMinutes, setWindowMinutes] = useState(funnel?.windowMinutes ?? DEFAULT_WINDOW_MINUTES);
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    funnel ? funnel.steps.map((step) => ({ stepKind: step.stepKind, match: step.match, matchMode: step.matchMode })) : [blankStep(), blankStep()],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setStep = (index: number, patch: Partial<StepDraft>) =>
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  const valid = name.trim().length > 0 && steps.length >= FUNNEL_MIN_STEPS && steps.every((step) => step.match.trim().length > 0);

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError('');
    const input: ReplayFunnelInput = {
      name: name.trim(),
      windowMinutes,
      steps: steps.map((step) => ({ ...step, match: step.match.trim() })),
    };
    try {
      const saved = funnel ? await replayApi.updateFunnel(siteId, funnel.id, input) : await replayApi.createFunnel(siteId, input);
      onSaved(saved);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!funnel) return;
    const ok = await confirm({ title: t('deleteTitle'), message: t('deleteConfirm', { name: funnel.name }), confirmLabel: t('delete'), destructive: true });
    if (!ok) return;
    setBusy(true);
    try {
      await replayApi.deleteFunnel(siteId, funnel.id);
      onDeleted?.(funnel.id);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label={funnel ? t('editTitle') : t('newTitle')}
      onSubmit={(event) => { event.preventDefault(); void save(); }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span>{t('name')}</span>
        <input className="input" value={name} onChange={(event) => setName(event.currentTarget.value)} style={{ minHeight: 44 }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span>{t('windowMinutes')}</span>
        <input
          className="input"
          type="number"
          min={1}
          value={windowMinutes}
          onChange={(event) => setWindowMinutes(Math.max(1, Number(event.currentTarget.value) || DEFAULT_WINDOW_MINUTES))}
          style={{ minHeight: 44, maxWidth: 160 }}
        />
      </label>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {steps.map((step, index) => (
          <li
            key={index}
            aria-label={t('stepAria', { n: index + 1 })}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)' }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', alignItems: 'center' }}>
              <strong style={{ minWidth: 24 }}>{index + 1}</strong>
              <select
                className="input"
                aria-label={t('stepKindAria', { n: index + 1 })}
                value={step.stepKind}
                onChange={(event) => setStep(index, { stepKind: event.currentTarget.value as ReplayFunnelStepKind })}
                style={{ minHeight: 44 }}
              >
                {FUNNEL_STEP_KINDS.map((kind) => <option key={kind} value={kind}>{t(`stepKind.${kind}`)}</option>)}
              </select>
              <select
                className="input"
                aria-label={t('matchModeAria', { n: index + 1 })}
                value={step.matchMode}
                onChange={(event) => setStep(index, { matchMode: event.currentTarget.value as ReplayMatchMode })}
                style={{ minHeight: 44 }}
              >
                {MATCH_MODES.map((mode) => <option key={mode} value={mode}>{tEvents(`matchMode.${mode}`)}</option>)}
              </select>
              <input
                className="input"
                aria-label={t('matchAria', { n: index + 1 })}
                placeholder={t(`matchPlaceholder.${step.stepKind}`)}
                value={step.match}
                onChange={(event) => setStep(index, { match: event.currentTarget.value })}
                style={{ minHeight: 44, flex: '1 1 160px', minWidth: 0 }}
              />
              <button
                type="button"
                className="btn-ghost"
                aria-label={t('removeStep', { n: index + 1 })}
                disabled={steps.length <= FUNNEL_MIN_STEPS}
                onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
                style={{ minHeight: 44, minWidth: 44 }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
            <RulePreview
              siteId={siteId}
              days={days}
              rule={step.match.trim() ? { ruleKind: STEP_RULE_KIND[step.stepKind], match: step.match, matchMode: step.matchMode } : null}
            />
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn-ghost"
        disabled={steps.length >= FUNNEL_MAX_STEPS}
        onClick={() => setSteps((current) => [...current, blankStep()])}
        style={{ alignSelf: 'flex-start', minHeight: 44 }}
      >
        <Icon name="plus" size={14} /> {t('addStep')}
      </button>

      {error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <button type="submit" className="btn-primary" disabled={busy || !valid} style={{ minHeight: 44 }}>{t('save')}</button>
        <button type="button" className="btn-ghost" onClick={onClose} style={{ minHeight: 44 }}>{t('cancel')}</button>
        {funnel && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void remove()} style={{ minHeight: 44, marginLeft: 'auto', color: 'var(--error)' }}>
            {t('delete')}
          </button>
        )}
      </div>
    </form>
  );
}
