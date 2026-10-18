import { useCallback, useState } from 'react';
import { useOptionalLiveSession } from '@/lib/live/LiveSessionContext';
import { useLatestRef } from './useLatestRef';

type Update<T> = T | ((current: T) => T);

/**
 * The two board facts a LIVE session owns when there is one — whether the board is being
 * presented, and whose view this viewer follows — with a local fallback when there is not.
 * Both setters take the functional-updater form, so each reads the CURRENT value through a
 * ref: the shell's value does not live in the caller's closure.
 */
export function useCanvasLiveSessionControls(initialPresent: boolean) {
  const liveSession = useOptionalLiveSession();
  const [localPresentMode, setLocalPresentMode] = useState(initialPresent);
  const presentMode = liveSession ? liveSession.presentMode : localPresentMode;
  const presentModeRef = useLatestRef(presentMode);
  const setPresentMode = useCallback((value: Update<boolean>) => {
    const next = typeof value === 'function' ? value(presentModeRef.current) : value;
    if (liveSession) liveSession.setPresentMode(next);
    else setLocalPresentMode(next);
  }, [liveSession, presentModeRef]);
  const [localFollowingUserId, setLocalFollowingUserId] = useState<string | null>(null);
  const followingUserId = liveSession ? liveSession.followingUserId : localFollowingUserId;
  const followingRef = useLatestRef(followingUserId);
  const setFollowingUserId = useCallback((value: Update<string | null>) => {
    const next = typeof value === 'function' ? value(followingRef.current) : value;
    if (liveSession) liveSession.setFollowing(next);
    else setLocalFollowingUserId(next);
  }, [followingRef, liveSession]);
  return { liveSession, presentMode, presentModeRef, setPresentMode, followingUserId, setFollowingUserId };
}
