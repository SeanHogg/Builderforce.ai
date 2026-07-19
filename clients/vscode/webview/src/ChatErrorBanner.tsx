import type { ChatErrorAction } from '@seanhogg/builderforce-brain-embedded';
import { invalidatePlanSnapshot, openUpgrade } from './accountPlan';

/**
 * The chat's error banner — the message AND the fix.
 *
 * A turn that fails because of an entitlement ("…require a validated card on
 * file. Add and validate a card in Settings ▸ Billing to unlock.") is only
 * actionable if the surface takes the user there. The verdict is decided once,
 * server-side, and carried through the run store as {@link ChatErrorAction} — so
 * this component reads a verdict rather than pattern-matching error prose, and
 * the button can never contradict the sentence above it.
 *
 * Self-gating: renders nothing without an error, and decides its own actions from
 * the verdict, so the caller neither computes nor passes any `canX` flag.
 */
export function ChatErrorBanner({
  error,
  action,
  onReconnect,
  onDismiss,
  t,
}: {
  error: string;
  action: ChatErrorAction | null;
  onReconnect: () => void;
  onDismiss: () => void;
  t: (key: string, fallback: string) => string;
}) {
  if (!error) return null;

  const kind = action?.kind;
  // A named plan makes the ask concrete ("Upgrade to Pro" beats "Upgrade").
  const planName = action?.requiredPlan
    ? action.requiredPlan.replace(/^./, (ch) => ch.toUpperCase())
    : null;

  return (
    <div className="bf-error" role="alert">
      <span className="bf-error__msg">{error}</span>
      <div className="bf-error__actions">
        {kind === 'auth' && (
          <button className="bf-btn bf-btn--primary" onClick={onReconnect}>
            {t('app.reconnect', 'Reconnect')}
          </button>
        )}
        {kind === 'upgrade' && (
          <button
            className="bf-btn bf-btn--primary"
            onClick={() => { invalidatePlanSnapshot(); openUpgrade('pricing'); }}
          >
            {planName
              ? t('app.upgradeToPlan', 'Upgrade to {plan}').replace('{plan}', planName)
              : t('app.upgrade', 'Upgrade')}
          </button>
        )}
        {kind === 'validate_card' && (
          <button
            className="bf-btn bf-btn--primary"
            onClick={() => { invalidatePlanSnapshot(); openUpgrade('billing'); }}
          >
            {t('app.addCard', 'Add a card')}
          </button>
        )}
        <button
          className="bf-btn bf-btn--icon"
          onClick={onDismiss}
          title={t('app.dismiss', 'Dismiss')}
          aria-label={t('app.dismiss', 'Dismiss')}
        >
          ×
        </button>
      </div>
    </div>
  );
}
