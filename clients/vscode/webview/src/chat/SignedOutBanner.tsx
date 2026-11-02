/**
 * Signed out, and nothing on this machine pinned as the route: say so INLINE, above the
 * composer, and keep the chat usable (a BYO key or an unpinned local-first model may
 * still serve the turn). Replaces the old full-surface "Sign in to start" wall.
 */
import { needsRouteBanner } from '../signedOutGate';
import { post, type InitData } from '../vscodeBridge';
import { makeT } from './chatLabels';

export function SignedOutBanner({ init }: { init: InitData }) {
  if (!needsRouteBanner({ signedIn: init.signedIn, localRoute: !!init.localRoute, localModelCount: init.localModels?.length ?? 0 })) {
    return null;
  }
  const t = makeT(init.labels);
  return (
    <div className="bf-notice" role="status">
      <span>{t('app.signedOutBanner', "You're not signed in. You can still chat with a local model or your own provider keys.")}</span>{' '}
      <button className="bf-btn bf-btn--primary" onClick={() => post('signin')}>{t('app.signIn', 'Sign in')}</button>{' '}
      <button className="bf-btn" onClick={() => post('connectProvider')}>{t('app.connectProvider', 'Connect a provider')}</button>{' '}
      <button className="bf-btn" onClick={() => post('downloadLocalModel')}>{t('app.useLocalModel', 'Use a local model')}</button>
    </div>
  );
}
