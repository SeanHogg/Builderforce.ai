'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ToastProvider';

/**
 * THE connect / disconnect control on an integration card — one component for every
 * connectable thing on Settings → Integrations: a BYO model provider, an OpenRouter
 * registration set, and an app integration (Jira, GitHub, …).
 *
 * Before this existed, the only way to disconnect anything was to open the card, find the
 * right tab, and remove credentials one at a time — the card itself showed the state
 * ("connected") with no way to act on it. The three surfaces would each have grown their
 * own button, their own busy handling and their own failure wording, so the action lives
 * here once and the surfaces supply only WHAT connecting and disconnecting mean for them.
 *
 * The button is deliberately dumb about consequences: `onDisconnect` owns its own confirm
 * (the wording differs — a subscription, a set of registrations, and a credential + its
 * sync are genuinely different losses) and simply resolves without throwing when the
 * operator cancels. A thrown error becomes a toast here so no caller has to remember to
 * report one.
 */
export function ConnectToggleButton({
  connected,
  name,
  onConnect,
  onDisconnect,
  disabled = false,
}: {
  connected: boolean;
  /** Display name of the integration — a brand, used for the accessible label. */
  name: string;
  /** Open the connect flow (the drawer that holds the credential form). */
  onConnect: () => void;
  /** Run the disconnect, confirm included. Resolve without throwing when cancelled. */
  onDisconnect: () => Promise<void>;
  disabled?: boolean;
}) {
  const t = useTranslations('common.connectToggle');
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const activate = async () => {
    if (!connected) {
      onConnect();
      return;
    }
    setBusy(true);
    try {
      await onDisconnect();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('errorGeneric'), { title: t('errorTitle', { name }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-label={connected ? t('disconnectAria', { name }) : t('connectAria', { name })}
      // The card behind this button opens a panel on click; without both of these, connecting
      // or disconnecting would also open it.
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void activate();
      }}
      style={{
        flexShrink: 0,
        padding: '6px 12px',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 650,
        cursor: disabled || busy ? 'default' : 'pointer',
        opacity: disabled || busy ? 0.55 : 1,
        // Connect leads (filled accent); disconnect is available but never the invitation.
        background: connected ? 'var(--bg-elevated)' : 'var(--coral-bright, #f4726e)',
        color: connected ? 'var(--danger, #dc2626)' : '#fff',
        border: `1px solid ${connected ? 'var(--border-subtle)' : 'var(--coral-bright, #f4726e)'}`,
      }}
    >
      {busy ? t('working') : connected ? t('disconnect') : t('connect')}
    </button>
  );
}
