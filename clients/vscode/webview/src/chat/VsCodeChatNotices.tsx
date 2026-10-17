/**
 * The banners about the run, between the thread and the composer — all through THE
 * shared `ChatErrorBanner` (message, remedy, dismiss):
 *
 * - a connected BYO account the gateway couldn't use this run (revoked, or connected in
 *   a DIFFERENT workspace) — the reason picks the sentence;
 * - a BYO provider key that hit its usage cap, so the run fell back to the shared pool;
 * - the failed turn itself, with the server-decided remedy (`chatErrorAction`).
 *
 * The first two are passive (`role="status"`) and dismissible until a NEW occurrence —
 * the shared `useDismissibleNotice` rule the web's provider-cap banner uses too. They
 * used to be hand-built `.bf-notice` rows with a text "×".
 */

import { useMemo } from 'react';
import { parseByoUnresolved, type UseBrainConversation } from '@seanhogg/builderforce-brain-embedded';
import { ChatErrorBanner, useDismissibleNotice } from '@seanhogg/builderforce-brain-ui';
import { openUpgrade } from '../accountPlan';
import { invalidatePlanSnapshot } from '../planSnapshot';
import { post, refreshToken } from '../vscodeBridge';

export function VsCodeChatNotices({ conv, t }: {
  conv: UseBrainConversation;
  t: (key: string, fallback: string) => string;
}) {
  const byo = useDismissibleNotice(conv.byoUnresolved);
  const byoKey = conv.byoUnresolved.join(',');
  const byoEntries = useMemo(() => parseByoUnresolved(conv.byoUnresolved), [byoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const byoProviders = byoEntries.map((e) => e.provider).join(', ');
  const byoOtherWorkspace = byoEntries.length > 0 && byoEntries.every((e) => e.reason === 'other-workspace');
  const cap = useDismissibleNotice(conv.providerCap);
  const dismiss = t('app.dismiss', 'Dismiss');

  return (
    <>
      {byo.show && (
        <ChatErrorBanner
          className="bf-notice"
          role="status"
          action={null}
          onDismiss={byo.dismiss}
          labels={{ dismiss }}
          error={(byoOtherWorkspace
            ? t(
                'app.byoOtherWorkspace',
                'Your {provider} account is connected in a DIFFERENT workspace, so this run used the shared model pool instead of your own model. Switch to that workspace, or connect it in this one under Settings ▸ API Keys.',
              )
            : t(
                'app.byoUnused',
                'Your connected {provider} account couldn’t be used this run (its token looks expired or revoked), so it ran on the shared model pool instead of your own model. Reconnect it in the web app under Settings ▸ API Keys.',
              )
          ).replace('{provider}', byoProviders)}
        />
      )}
      {cap.show && (
        <ChatErrorBanner
          className="bf-notice"
          role="status"
          action={null}
          onDismiss={cap.dismiss}
          labels={{ dismiss }}
          error={t(
            'app.providerCapHit',
            'Your {providers} API key hit its usage limit this run, so it fell back to the shared model pool. Manage your API keys in the web app under Settings ▸ API Keys.',
          ).replace('{providers}', conv.providerCap.join(', '))}
        />
      )}
      <ChatErrorBanner
        className="bf-error"
        error={conv.error}
        action={conv.errorAction}
        // Re-exchange the session, then clear the banner the expired token raised.
        onReconnect={() => { void refreshToken(); conv.clearError(); }}
        onUpgrade={() => { invalidatePlanSnapshot(); openUpgrade('pricing'); }}
        onValidateCard={() => { invalidatePlanSnapshot(); openUpgrade('billing'); }}
        onSignIn={() => post('signin')}
        onDismiss={conv.clearError}
        labels={{
          reconnect: t('app.reconnect', 'Reconnect'),
          upgrade: t('app.upgrade', 'Upgrade'),
          upgradeToPlan: t('app.upgradeToPlan', 'Upgrade to {plan}'),
          addCard: t('app.addCard', 'Add a card'),
          signIn: t('app.signIn', 'Sign in'),
          noModel: t('app.noModel', 'No model is available. Sign in, or start a model on this device.'),
          dismiss,
        }}
      />
    </>
  );
}
