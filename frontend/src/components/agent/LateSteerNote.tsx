import { useTranslations } from 'next-intl';
import type { ExecutionMessageFollowUp } from '@/lib/builderforceApi';

/**
 * The line under a steer that arrived after its run's last turn.
 *
 * Such a steer no longer reaches the run it was sent to — it starts a follow-up run on
 * the same branch (operator decision 2026-09-12). Without this line the Output thread
 * showed the message as if the run had read it. The line says what actually happened:
 * the run it continued as (with a way to open it), a follow-up waiting on approval, or
 * why no follow-up started (an entitlement refusal, a cancelled run).
 *
 * No `'use client'` of its own: it is only rendered by the (client) execution panel.
 */
export function LateSteerNote({
  followUp,
  onOpenRun,
}: {
  followUp: ExecutionMessageFollowUp;
  onOpenRun: (executionId: number) => void;
}) {
  const t = useTranslations('agentExecution');
  const started = followUp.outcome === 'started' && followUp.executionId != null;
  const text = started
    ? t('lateSteerContinued', { id: followUp.executionId as number })
    : followUp.outcome === 'awaiting_approval'
      ? t('lateSteerAwaitingApproval')
      : followUp.outcome === 'released'
        ? t('lateSteerReleased')
        : t('lateSteerNotContinued', { reason: followUp.detail ?? '' });
  const tone = started || followUp.outcome === 'awaiting_approval' ? 'var(--text-muted)' : 'var(--danger)';

  return (
    <div
      role="note"
      style={{ alignSelf: 'flex-end', maxWidth: '85%', fontSize: 11, color: tone, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginTop: -6 }}
    >
      <span>{text}</span>
      {started && (
        <button
          type="button"
          onClick={() => onOpenRun(followUp.executionId as number)}
          style={{ border: 'none', background: 'none', padding: 0, fontSize: 11, color: 'var(--coral-bright)', cursor: 'pointer', textDecoration: 'underline' }}
        >
          {t('lateSteerOpenRun', { id: followUp.executionId as number })}
        </button>
      )}
    </div>
  );
}
