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
  dismiss: string;
}

export const DEFAULT_CHAT_ERROR_LABELS: ChatErrorBannerLabels = {
  reconnect: 'Reconnect',
  upgrade: 'Upgrade',
  upgradeToPlan: 'Upgrade to {plan}',
  addCard: 'Add a card',
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
  labels?: Partial<ChatErrorBannerLabels>;
  /** Extra styles merged into the banner container, for host-specific chrome. */
  style?: React.CSSProperties;
  /** Class on the banner container — the VS Code webview styles via its own CSS. */
  className?: string;
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
  labels: labelOverrides,
  style,
  className,
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
          : null;

  return (
    <div
      className={className}
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        flexWrap: 'wrap',
        fontSize: 13,
        ...style,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{error}</span>
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
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
