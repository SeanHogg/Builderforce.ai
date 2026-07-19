'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChatErrorBanner } from '@seanhogg/builderforce-brain-ui';
import type { ChatErrorAction } from '@seanhogg/builderforce-brain-embedded';
import { useStartCardValidation } from '@/lib/useCardValidation';
import { invalidateConsumption } from '@/lib/useConsumption';

/**
 * Web wiring for the SHARED chat error banner.
 *
 * The banner itself — verdict → remedy, and the rule that a remedy is only offered
 * when the surface can actually perform it — lives in `@seanhogg/builderforce-brain-ui`
 * so the VS Code webview and the web app never drift on what a blocked turn offers.
 * This adapter supplies only what is genuinely web-specific: next-intl copy, the
 * router, and the card-validation flow.
 *
 * No `onReconnect`: on the web an expired session is handled globally by
 * AuthContext (redirect to sign-in), so the shared banner correctly omits that
 * button rather than offering one that does nothing.
 */
export function BrainErrorBanner({
  error,
  action,
  onDismiss,
}: {
  error: string;
  action: ChatErrorAction | null;
  onDismiss: () => void;
}) {
  const t = useTranslations('brain');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { start: startCardValidation, error: cardError } = useStartCardValidation();

  // A failed card attempt belongs with the message it was meant to fix, not in a
  // second banner the user has to correlate.
  const message = cardError === null
    ? error
    : `${error} — ${cardError || t('cardValidationFailed')}`;

  // The shared banner substitutes `{plan}` into `upgradeToPlan` itself, but a raw
  // `{plan}` in a next-intl catalog is an ICU placeholder and would throw. So the
  // plan name is interpolated HERE and the finished sentence handed over — the
  // banner's `.replace()` then finds no token and leaves it alone. It only reaches
  // for this label under the same `requiredPlan != null` condition, so the two
  // never disagree about which of the two CTAs is shown.
  const plan = action?.requiredPlan?.replace(/^./, (ch) => ch.toUpperCase());

  return (
    <ChatErrorBanner
      error={message}
      action={action}
      onDismiss={onDismiss}
      onUpgrade={() => {
        // The tier may change while they're away; don't serve a stale chip on return.
        invalidateConsumption();
        router.push('/pricing?upgrade=pro');
      }}
      onValidateCard={() => { void startCardValidation(); }}
      labels={{
        upgrade: t('upgrade'),
        ...(plan ? { upgradeToPlan: t('upgradeToPlan', { plan }) } : {}),
        addCard: t('addCard'),
        dismiss: tCommon('dismiss'),
      }}
      style={{
        margin: '8px 12px 0',
        padding: '8px 12px',
        background: 'var(--error-bg)',
        color: 'var(--error-text)',
        borderRadius: 8,
      }}
    />
  );
}
