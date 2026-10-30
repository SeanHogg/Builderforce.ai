import { clearPendingWords, setPendingWordsOwner } from '@seanhogg/builderforce-brain-embedded/pendingWords';
import type { Session } from '../auth/session';

/**
 * Whose unsaved words this device may keep. Words not yet saved are journaled for the signed-in workspace (a Rovr profile is
 * one person's) and are gone with the sign-in: the next one may be someone else's. SIGNED OUT there is no owner and so no
 * journal - nothing is re-named after the sign-out cleared it, or the next person to sign in would inherit it.
 */
export function bindPendingWordsOwner(session: Pick<Session, 'isSignedIn' | 'tenantId' | 'subscribe'>): void {
  const follow = (): void => {
    if (!session.isSignedIn()) {
      clearPendingWords();
      return;
    }
    setPendingWordsOwner({ tenant: session.tenantId() ?? 'local', user: 'rovr' });
  };
  follow();
  session.subscribe(follow);
}
