import { memo } from 'react';
import { useTranslations } from 'next-intl';
import type { AssessmentGate } from '@/lib/academic/assessment';

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
