import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { AssessmentGate } from '@/lib/academic/assessment';
import type { ChatInputAttachment } from './types';

/**
 * Why the composer refuses, or that it is being recorded — said in words, never
 * left to a greyed box a learner has to guess the reason for. Nothing while open.
 */
export const AssessmentGateNotice = memo(function AssessmentGateNotice({ gate }: { gate: AssessmentGate }) {
  const t = useTranslations('chatInput');
  if (gate.mode === 'open') return null;
  return (
    <p role="status" data-testid="composer-assessment-gate" data-mode={gate.mode} style={{ margin: 0, fontSize: 'var(--font-size-small)', color: gate.assistantAllowed ? 'var(--text-secondary)' : 'var(--error-text)' }}>
      {gate.assistantAllowed ? t('assessmentAssisted') : t('assessmentClosedBook')}
    </p>
  );
});

/**
 * Turns held behind the running one. The receipt for a composer that never
 * refuses input — same sentence, same place, on every surface. Zero renders nothing.
 */
export const QueuedTurnsReceipt = memo(function QueuedTurnsReceipt({ count }: { count: number }) {
  // The queued-turns receipt speaks the conversation's vocabulary, from the same
  // catalog the Brain surface reads — one sentence, not one per host.
  const tBrain = useTranslations('brain');
  if (!(count > 0)) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
      <span aria-hidden><Icon source="⏳" size="1em" /></span>
      {tBrain('queuedCount', { count })}
    </div>
  );
});

/** The attachments waiting to go with the next turn, each removable. */
export const PendingAttachmentChips = memo(function PendingAttachmentChips({ attachments, onRemove }: {
  attachments: ChatInputAttachment[];
  onRemove: (key: string) => void;
}) {
  const t = useTranslations('chatInput');
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {attachments.map((a) => (
        <span key={a.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 'var(--radius-md)', background: 'var(--surface-coral-soft)', fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}>

          <Icon source="📎" size="1em" /> {a.name}
          <button type="button" onClick={() => onRemove(a.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', padding: 0 }} aria-label={t('removeAttachment')}>×</button>
        </span>
      ))}
    </div>
  );
});
