import React from 'react';
import type { ChatErrorAction } from '@seanhogg/builderforce-brain-embedded';

/**
 * The chat's error banner — the message AND the fix.
 *
 * A turn that fails on an entitlement ("…require a validated card on file. Add
 * and validate a card in Settings ▸ Billing to unlock.") is only actionable if
 * the surface takes the user there. The verdict is decided ONCE, server-side,
 * and carried through the run store as {@link ChatErrorAction} — so this
 * component reads a verdict rather than pattern-matching error prose, and the
 * button can never contradict the sentence above it.
 *
 * Shared because both chat surfaces hit the same wall: the VS Code webview and
 * the web app's <BrainPanel> render the same failures from the same hook, and a
 * user who upgrades from one and returns to the other should not find a
 * different (or missing) remedy.
 *
 * Self-gating: renders nothing without an error, and decides its own actions from
 * the verdict — the host passes handlers, never a `canX` flag.
 */

export interface ChatErrorBannerLabels {
  /** Re-exchange an expired session token. */
  reconnect: string;
  /** Upgrade CTA when the server named no specific plan. */
  upgrade: string;
  /** Upgrade CTA naming the plan — must contain the literal `{plan}` token. */
  upgradeToPlan: string;
  /** Billing CTA when the plan is fine but no validated card is on file. */
  addCard: string;
  /** Sign in — offered when no model can serve the turn (signed out, nothing local). */
  signIn: string;
  /** What the banner says for that case — replaces the raw `not_signed_in` code. */
  noModel: string;
  dismiss: string;
}

export const DEFAULT_CHAT_ERROR_LABELS: ChatErrorBannerLabels = {
  reconnect: 'Reconnect',
  upgrade: 'Upgrade',
  upgradeToPlan: 'Upgrade to {plan}',
  addCard: 'Add a card',
  signIn: 'Sign in',
  noModel: 'No model is available. Sign in, or start a model on this device.',
  dismiss: 'Dismiss',
};

export interface ChatErrorBannerProps {
  /** The message to show. Falsy ⇒ the banner renders nothing. */
  error: string;
  /** The server-decided remedy, from `useBrainConversation().errorAction`. */
  action: ChatErrorAction | null;
  onDismiss: () => void;
  /**
   * Re-authenticate. Omit on a surface with no in-place reconnect (the web app
   * redirects to login instead) — the button then isn't offered.
   */
  onReconnect?: () => void;
  /**
   * Send the user somewhere they can raise their plan. Omit to suppress the
   * button (e.g. a logged-out surface that owns its own sign-up upsell).
   */
  onUpgrade?: () => void;
  /** Send the user somewhere they can put a validated card on file. */
  onValidateCard?: () => void;
  /** Sign in (or open where a local model is started) — for the `sign_in` verdict. */
  onSignIn?: () => void;
  labels?: Partial<ChatErrorBannerLabels>;
  /** Extra styles merged into the banner container, for host-specific chrome. */
  style?: React.CSSProperties;
  /** Class on the banner container — the VS Code webview styles via its own CSS. */
  className?: string;
  /**
   * `alert` (default) for a failed turn. `status` for a passive notice the run still
   * finished through — a connected account it could not use, a provider key at its cap —
   * which a screen reader should announce politely rather than interrupt with.
   */
  role?: 'alert' | 'status';
}

/** Title-case a plan key for display ('pro' → 'Pro'). */
function planLabel(plan: string): string {
  return plan.replace(/^./, (ch) => ch.toUpperCase());
}

export function ChatErrorBanner({
  error,
  action,
  onDismiss,
  onReconnect,
  onUpgrade,
  onValidateCard,
  onSignIn,
  labels: labelOverrides,
  style,
  className,
  role = 'alert',
}: ChatErrorBannerProps) {
  const labels = { ...DEFAULT_CHAT_ERROR_LABELS, ...labelOverrides };
  if (!error) return null;

  const kind = action?.kind;
  // A named plan makes the ask concrete ("Upgrade to Pro" beats "Upgrade").
  const plan = action?.requiredPlan ? planLabel(action.requiredPlan) : null;

  // Each remedy needs BOTH a matching verdict and a handler from the host; a
  // surface that can't perform one simply doesn't offer it.
  const primary =
    kind === 'auth' && onReconnect
      ? { label: labels.reconnect, onClick: onReconnect }
      : kind === 'upgrade' && onUpgrade
        ? {
            label: plan ? labels.upgradeToPlan.replace('{plan}', plan) : labels.upgrade,
            onClick: onUpgrade,
          }
        : kind === 'validate_card' && onValidateCard
          ? { label: labels.addCard, onClick: onValidateCard }
          : kind === 'sign_in' && onSignIn
            ? { label: labels.signIn, onClick: onSignIn }
            : null;
  // The verdict names the case; the raw sentinel is never what a person reads.
  const message = kind === 'sign_in' ? labels.noModel : error;

  return (
    <div
      className={className}
      role={role}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        flexWrap: 'wrap',
        fontSize: 13,
        ...style,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{message}</span>
      {primary && (
        <button
          type="button"
          onClick={primary.onClick}
          style={{
            flex: '0 0 auto',
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 700,
            color: 'inherit',
            background: 'transparent',
            border: '1px solid currentColor',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {primary.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        title={labels.dismiss}
        aria-label={labels.dismiss}
        style={{
          flex: '0 0 auto',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          lineHeight: 0,
          padding: 2,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
