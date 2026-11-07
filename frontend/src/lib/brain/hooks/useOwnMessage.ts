import { useMemo } from 'react';
import { ownMessageOf } from '@seanhogg/builderforce-brain-ui';
import { useAuth } from '@/lib/AuthContext';

/**
 * The web's `isOwnMessage` for `<BrainTimeline>` (PRD 42 Part E): the signed-in user is the viewer, so a
 * teammate's human message is offered for translation and the viewer's own never is. A signed-out guest
 * has no id, so nothing is translated. Stable per viewer, so the memoised timeline does not re-render.
 */
export function useOwnMessage() {
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  return useMemo(() => ownMessageOf(viewerId), [viewerId]);
}
