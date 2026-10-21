/**
 * The banners about the run, between the thread and the composer — all through THE
 * shared `ChatErrorBanner` (message, remedy, dismiss):
 *
 * - a connected BYO account the gateway couldn't use this run (revoked, or connected in
 *   a DIFFERENT workspace) — the reason picks the sentence;
 * - a BYO provider key that hit its usage cap, so the run fell back to the shared pool;
 * - the failed turn itself, with the server-decided remedy (`chatErrorAction`);
 * - a failed history action (summarize, rename, delete) — the shared `useBrainChats`
 *   reports those through its own `error`, which nothing else on this surface shows;
 * - Hybrid's pick failed and the turn was answered with Auto — brain-ui's one-line
 *   `ModelFallbackNotice`, fed by the host's `run.modelFallback` (`hostRunDriver`).
 *
 * The first two are passive (`role="status"`) and dismissible until a NEW occurrence —
 * the shared `useDismissibleNotice` rule the web's provider-cap banner uses too. They
 * used to be hand-built `.bf-notice` rows with a text "×".
 */

import { useMemo } from 'react';
import { parseByoUnresolved, type UseBrainConversation } from '@seanhogg/builderforce-brain-embedded';
import { ChatErrorBanner, ModelFallbackNotice, useDismissibleNotice } from '@seanhogg/builderforce-brain-ui';
import { hostModelFallback } from '../hostRunDriver';
import { openUpgrade } from '../accountPlan';
import { invalidatePlanSnapshot } from '../planSnapshot';
import { post, refreshToken, type InitData, type LabelBundle } from '../vscodeBridge';
import { chatErrorLabels, makeT } from './chatLabels';
import { modelRemedies } from './inferenceModeOption';

export function VsCodeChatNotices({ conv, chatsError, onDismissChatsError, bundle, init, composerId }: {
  conv: UseBrainConversation;
  chatsError: string;
  onDismissChatsError: () => void;
  /** The host's label bundle. */
  bundle: LabelBundle;
  /** The host's `init` frame — the inference mode decides the `no_local_model` remedies. */
  init?: InitData;
  /** The composer beside this banner — "Pick a model" opens ITS `/` menu. */
  composerId: string;
}) {
  const t = makeT(bundle);
  const errorLabels = useMemo(() => chatErrorLabels(bundle), [bundle]);
  const byo = useDismissibleNotice(conv.byoUnresolved);
  const byoKey = conv.byoUnresolved.join(',');
  const byoEntries = useMemo(() => parseByoUnresolved(conv.byoUnresolved), [byoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const byoProviders = byoEntries.map((e) => e.provider).join(', ');
  const byoOtherWorkspace = byoEntries.length > 0 && byoEntries.every((e) => e.reason === 'other-workspace');
  const cap = useDismissibleNotice(conv.providerCap);

  return (
    <>
      {byo.show && (
        <ChatErrorBanner
          className="bf-notice"
          role="status"
          action={null}
          onDismiss={byo.dismiss}
          labels={errorLabels}
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
          labels={errorLabels}
          error={t(
            'app.providerCapHit',
            'Your {providers} API key hit its usage limit this run, so it fell back to the shared model pool. Manage your API keys in the web app under Settings ▸ API Keys.',
          ).replace('{providers}', conv.providerCap.join(', '))}
        />
      )}
      <ModelFallbackNotice
        channel={hostModelFallback}
        labels={{
          fallback: t('app.modelFallback', 'Your pick {model} failed; answered with Auto.'),
          dismiss: errorLabels.dismiss,
        }}
      />
      {/* A chat the first send could not create fails the turn too — show that once. */}
      <ChatErrorBanner className="bf-error" error={chatsError === conv.error ? '' : chatsError} action={null} onDismiss={onDismissChatsError} labels={errorLabels} />
      <ChatErrorBanner
        className="bf-error"
        error={conv.error}
        action={conv.errorAction}
        // Re-exchange the session, then clear the banner the expired token raised.
        onReconnect={() => { void refreshToken(); conv.clearError(); }}
        onUpgrade={() => { invalidatePlanSnapshot(); openUpgrade('pricing'); }}
        onValidateCard={() => { invalidatePlanSnapshot(); openUpgrade('billing'); }}
        onSignIn={() => post('signin')}
        // Nothing can take the turn for a reason sign-in won't fix: Hybrid (only while on
        // Local only), a local model, or — Specific with nothing picked — the Model tab.
        {...modelRemedies(init, composerId, conv.clearError)}
        onDismiss={conv.clearError}
        labels={errorLabels}
      />
    </>
  );
}
