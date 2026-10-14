/**
 * "Draft a new sequence" in Follow up's gate (PRD 33 §5.1.4, D13): the 2–3 steps the
 * API drafted from the finding's cited objection, editable BEFORE anyone is enrolled
 * — name, and per step the days after enrolment, subject and body. Presentational:
 * `FollowUpPreview` owns the draft and confirms it. Nothing is sent from here; the
 * sequence is created as a draft cadence a person starts on its board.
 */

import { useTranslations } from 'next-intl';
import type { ReplayFollowUpSequenceDraftDto } from '@builderforce/interaction-contract';

export interface FollowUpSequenceDraftProps {
  draft: ReplayFollowUpSequenceDraftDto;
  onChange: (next: ReplayFollowUpSequenceDraftDto) => void;
  disabled: boolean;
}

type Step = ReplayFollowUpSequenceDraftDto['steps'][number];

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 } as const;
const smallStyle = { fontSize: 'var(--font-size-small)' } as const;

export function FollowUpSequenceDraft({ draft, onChange, disabled }: FollowUpSequenceDraftProps) {
  const t = useTranslations('replay.prescription.followUp.newSequence');
  const setStep = (index: number, patch: Partial<Step>) => onChange({
    ...draft,
    steps: draft.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
  });
  return (
    <div data-testid="follow-up-sequence-draft" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', ...smallStyle }}>{t('hint')}</p>
      <label style={fieldStyle}>
        <span style={smallStyle}>{t('nameLabel')}</span>
        <input
          className="input"
          value={draft.name}
          maxLength={80}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, name: event.currentTarget.value })}
          style={{ minHeight: 44 }}
        />
      </label>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {draft.steps.map((step, index) => (
          // Steps are positional: the draft never reorders while it is edited.
          <li
            key={index}
            aria-label={t('stepTitle', { n: index + 1 })}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', minWidth: 0 }}
          >
            <strong style={smallStyle}>{t('stepTitle', { n: index + 1 })}</strong>
            <label style={fieldStyle}>
              <span style={smallStyle}>{t('delayLabel')}</span>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                value={step.delayDays}
                disabled={disabled}
                onChange={(event) => setStep(index, { delayDays: Math.max(0, Math.round(Number(event.currentTarget.value) || 0)) })}
                style={{ minHeight: 44, maxWidth: 120 }}
              />
            </label>
            <label style={fieldStyle}>
              <span style={smallStyle}>{t('subjectLabel')}</span>
              <input
                className="input"
                value={step.subject}
                maxLength={200}
                disabled={disabled}
                onChange={(event) => setStep(index, { subject: event.currentTarget.value })}
                style={{ minHeight: 44 }}
              />
            </label>
            <label style={fieldStyle}>
              <span style={smallStyle}>{t('bodyLabel')}</span>
              <textarea
                className="input"
                rows={4}
                maxLength={2_000}
                value={step.body}
                disabled={disabled}
                onChange={(event) => setStep(index, { body: event.currentTarget.value })}
                style={{ minHeight: 44, resize: 'vertical' }}
              />
            </label>
          </li>
        ))}
      </ol>
    </div>
  );
}
