import { useEffect, useState } from 'react';
import { shouldAcquireCanvasObjectLock } from '@/domains/canvas/domain/selection';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { faultText } from '@/lib/apiClient';

/**
 * The lease on the selected object, and whether a direct edit ON it can land at all.
 *
 * Locks are server records. A freshly added node exists in React state before the
 * debounced graph save creates its row, so locking it immediately would 404 — the lease
 * starts only for an id the server has confirmed (`persistedObjectIds`). It renews every
 * 45s and is released when the selection moves on.
 *
 * `lockBlocked` is DERIVED rather than cleared by the effect: an object that needs no lock
 * is never blocked, and a refusal only ever applies to the object it was asked for.
 */
export function useCanvasObjectLock({ persistence, selectedId, canEdit, persistedObjectIds, sessionId, setNotice, lockedNotice }: {
  persistence: 'local' | 'server';
  selectedId: string | null;
  canEdit: boolean;
  persistedObjectIds: Set<string>;
  sessionId: string;
  setNotice: (text: string) => void;
  /** What the pill says when another editor holds the object. */
  lockedNotice: string;
}): { lockBlocked: boolean } {
  const [lockRefusal, setLockRefusal] = useState<{ objectId: string; blocked: boolean } | null>(null);
  const lockObjectId = shouldAcquireCanvasObjectLock(persistence, selectedId, canEdit, persistedObjectIds) ? selectedId : null;
  const lockBlocked = lockObjectId !== null && lockRefusal?.objectId === lockObjectId && lockRefusal.blocked;
  useEffect(() => {
    if (lockObjectId === null) return;
    const lockedObjectId = lockObjectId;
    let stopped = false;
    const acquire = async (action: 'acquire' | 'renew') => {
      try {
        await creationSessionsApi.lock(sessionId, lockedObjectId, action);
        if (!stopped) setLockRefusal({ objectId: lockedObjectId, blocked: false });
      } catch (error) {
        if (!stopped) { setLockRefusal({ objectId: lockedObjectId, blocked: true }); setNotice(faultText(error, lockedNotice)); }
      }
    };
    void acquire('acquire');
    const timer = window.setInterval(() => void acquire('renew'), 45_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      void creationSessionsApi.lock(sessionId, lockedObjectId, 'release').catch(() => undefined);
    };
  }, [lockObjectId, sessionId, setNotice, lockedNotice]);
  return { lockBlocked };
}
