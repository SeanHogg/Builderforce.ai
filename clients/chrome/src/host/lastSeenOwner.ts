import { claimLastSeenMemory, lastSeenIdentity } from '@builderforce/knowledge-browser';
import type { Session } from '../auth/session';

/**
 * Whose "last seen" knowledge graphs the panel may keep in memory. They outlive a view's source, so a
 * sign-out or a change of workspace must drop them: the next sign-in may be someone else's. The rule is
 * the shared `claimLastSeenMemory` (the web calls the same one); this only feeds it Rovr's session.
 *
 * The identity is workspace-only ("rovr" stands in for the person): Rovr's session is an access key plus
 * a tenant id and exposes NO user id, so there is nothing truer to key on. A Rovr profile is one person's.
 *
 * Returns the unsubscribe; the panel's teardown (`PanelServices.dispose`) calls it, so a torn-down panel
 * stops claiming the memory.
 */
export function bindLastSeenOwner(session: Pick<Session, 'isSignedIn' | 'tenantId' | 'subscribe'>): () => void {
  const follow = (): void => {
    const tenant = session.tenantId();
    claimLastSeenMemory(session.isSignedIn() ? lastSeenIdentity('rovr', tenant ?? 'local') : null);
  };
  follow();
  return session.subscribe(follow);
}
