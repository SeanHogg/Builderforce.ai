'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { METHOD_STEP_SPECS, methodStepKey, type MethodStep } from '@/lib/methodology';
import { canvasIntentHref } from '@/lib/canvasIntent';
import { useFounderJourney } from '@/lib/useFounderJourney';
import { SessionGate, type GatedAction } from '@/components/guest/SessionGate';
import styles from './ActRail.module.css';

/** Read is a free reformulation of the idea; Prove and Build each call a model
 *  or publish something, so both ask for an account — the same two existing
 *  `SessionGate` actions the rest of the product gates AI generation and
 *  publishing behind, no new member of the union. */
const STEP_GATE: Partial<Record<MethodStep, GatedAction>> = { prove: 'generate', build: 'publish' };

/**
 * The inner loop — Read → Prove → Build — as three cards on the Idea tab.
 * Self-contained: reads `useFounderJourney()` for which act is current and
 * which session to continue, so it drops onto any surface unchanged.
 */
export function ActRail() {
  const t = useTranslations('methodology');
  const journey = useFounderJourney();

  return (
    <ol className={styles.rail}>
      {METHOD_STEP_SPECS.map((step, index) => {
        const current = journey.stage === 'idea' && journey.act === step.id;
        const href = journey.activeSessionId
          ? `/create/${encodeURIComponent(journey.activeSessionId)}`
          : canvasIntentHref(t(methodStepKey(step.id, 'prompt')));
        const gate = STEP_GATE[step.id];

        const card = (
          <Link href={href} className={styles.cell} data-step={step.id} data-current={current}>
            <span className={styles.top}>
              <span className={styles.icon} aria-hidden="true"><Icon source={step.icon} size={18} /></span>
              <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
            </span>
            <h3 className={styles.title}>{t(methodStepKey(step.id, 'title'))}</h3>
            <p className={styles.question}>{t(methodStepKey(step.id, 'question'))}</p>
            <p className={styles.body}>{t(methodStepKey(step.id, 'body'))}</p>
            <span className={styles.action}>{t('cardAction')}</span>
          </Link>
        );

        return (
          <li key={step.id}>
            {gate ? <SessionGate action={gate} variant="block">{card}</SessionGate> : card}
          </li>
        );
      })}
    </ol>
  );
}
