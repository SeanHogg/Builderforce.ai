import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChatErrorBanner } from '@seanhogg/builderforce-brain-ui';
import type { ChatErrorAction } from '@seanhogg/builderforce-brain-embedded';
import { useStartCardValidation } from '@/lib/useCardValidation';
import { invalidateConsumption } from '@/lib/useConsumption';
import { useModelRemedies } from './useModelRemedies';

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
  composerId,
}: {
  error: string;
  action: ChatErrorAction | null;
  onDismiss: () => void;
  /** The composer beside this banner — the one a "Pick a model" / "Download a local
   *  model" remedy opens the `/` menu of. */
  composerId: string;
}) {
  const t = useTranslations('brain');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { start: startCardValidation, error: cardError } = useStartCardValidation();
  const { labels: remedyLabels, ...remedies } = useModelRemedies(onDismiss, composerId);

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
  const plan = action?.requiredPlan?.replace(/^./, (ch: string) => ch.toUpperCase());

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
      onSignIn={() => router.push('/login')}
      // Nothing can take the turn for a reason sign-in won't fix: nothing on this device
      // (Local only, or no cloud route), or Specific model with nothing picked.
      {...remedies}
      labels={{
        upgrade: t('upgrade'),
        ...(plan ? { upgradeToPlan: t('upgradeToPlan', { plan }) } : {}),
        addCard: t('addCard'),
        signIn: t('signIn'),
        noModel: t('noModel'),
        ...remedyLabels,
        dismiss: tCommon('dismiss'),
      }}
      style={{
        margin: '8px 12px 0',
        padding: '8px 12px',
        background: 'var(--error-bg)',
        color: 'var(--error-text)',
        borderRadius: 'var(--radius-md)',
      }}
    />
  );
}
