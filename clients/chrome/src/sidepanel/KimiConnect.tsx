/**
 * Kimi in Rovr — connect the workspace's Kimi account and pick a Kimi model.
 *
 *   • {@link KimiAccountSection} — Settings → Model: connect, or (connected) the account's
 *     models as pins, in the workspace's chosen order.
 *   • {@link KimiConnectCard} — the chat notice a Kimi turn raises when the account is not
 *     connected yet; connecting from it clears the failed turn so the next send runs.
 *
 * Both are thin over {@link useKimiConnect} and render nothing signed out: a connection
 * belongs to a workspace, and there is none to connect to.
 */
import { formatLocalModelRef } from '@builderforce/local-inference';
import { t } from '../i18n/t';
import { KIMI_RUNTIME } from '../inference/connectedAccount';
import { usePinnedModel, useSignedIn } from './hooks';
import { useKimiConnect, type KimiConnectState } from './useKimiConnect';

/** Kimi's plan-gated models — marked so nobody pins one their plan cannot serve unawares. */
const K3_IDS = new Set(['k3', 'k3-256k']);

function KimiConnectControls({ state, onConnect, onCancel }: { state: KimiConnectState; onConnect(): void; onCancel(): void }) {
  if (state.phase === 'connecting') {
    return (
      <div className="rovr-row rovr-row--spread" role="status">
        <span>{state.userCode ? t('kimiApproveWithCode', state.userCode) : t('kimiApprove')}</span>
        <button type="button" className="bf-btn" onClick={onCancel}>{t('kimiCancel')}</button>
      </div>
    );
  }
  return (
    <div className="rovr-stack">
      {state.phase === 'failed' ? <p className="rovr-muted" role="alert">{state.message}</p> : null}
      <button type="button" className="bf-btn bf-btn--primary" onClick={onConnect}>{t('kimiConnect')}</button>
    </div>
  );
}

export function KimiAccountSection() {
  const signedIn = useSignedIn();
  const { credential, state, connect, cancel } = useKimiConnect();
  const [pinned, choose] = usePinnedModel();
  if (!signedIn) return null;

  return (
    <div className="rovr-stack">
      {/* "Kimi" is a brand name and stays as-is in every locale. */}
      <h3 className="rovr-h2">Kimi</h3>
      <p className="rovr-muted">{credential ? t('kimiConnectedIntro') : t('kimiIntro')}</p>
      {credential ? (
        <ul className="rovr-list">
          {credential.models.map((entry) => {
            const ref = formatLocalModelRef(KIMI_RUNTIME, entry.model);
            return (
              <li key={entry.model}>
                <button
                  type="button"
                  className={`bf-btn${pinned === ref ? ' bf-btn--primary' : ''}`}
                  aria-pressed={pinned === ref}
                  onClick={() => choose(ref)}
                >
                  {entry.displayName}
                  {K3_IDS.has(entry.model) ? <span className="rovr-muted"> · {t('kimiK3Plan')}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <KimiConnectControls state={state} onConnect={() => void connect()} onCancel={cancel} />
      )}
    </div>
  );
}

export function KimiConnectCard({ onConnected }: { onConnected(): void }) {
  const signedIn = useSignedIn();
  const { state, connect, cancel } = useKimiConnect();
  if (!signedIn) return null;
  return (
    <div className="rovr-card rovr-stack" role="region" aria-label={t('kimiCardTitle')}>
      <p className="rovr-card__title">{t('kimiCardTitle')}</p>
      <p className="rovr-muted">{t('kimiCardBody')}</p>
      <KimiConnectControls
        state={state}
        onConnect={() => void connect().then((ok) => ok && onConnected())}
        onCancel={cancel}
      />
    </div>
  );
}
