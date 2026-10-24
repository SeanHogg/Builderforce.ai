/**
 * Why the board is not drawn — the line above the chat when a server-persisted board
 * is waiting on (or could not get) the tenant token. Decides its own visibility:
 * nothing when the board is ready or there is no board at all.
 */
import { makeT } from '../chat/chatLabels';
import { post } from '../vscodeBridge';
import type { BoardAuth } from './useBoardAuth';

export function BoardAuthNotice({ auth, labels }: { auth: BoardAuth; labels: Record<string, string> }) {
  if (auth.state === 'ready' || auth.state === 'none') return null;
  const t = makeT(labels);
  if (auth.state === 'connecting') {
    return <div className="bf-canvas-degraded" role="status">{t('app.connecting', 'Connecting…')}</div>;
  }
  const signedOut = auth.state === 'signedOut';
  return (
    <div className="bf-canvas-degraded" role="status">
      {signedOut
        ? t('app.signInPrompt', 'Sign in to BuilderForce to start.')
        : t('app.connectFailed', "Couldn't reach BuilderForce. Check your connection and try again.")}{' '}
      <button
        type="button"
        className="bf-canvas-degraded__retry"
        onClick={() => (signedOut ? post('signin') : void auth.retry())}
      >
        {signedOut ? t('app.signIn', 'Sign in') : t('app.retry', 'Retry')}
      </button>
    </div>
  );
}
