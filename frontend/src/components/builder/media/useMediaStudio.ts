// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useCallback, useMemo, useState } from 'react';
import type { ProjectMediaItem } from '@/lib/projectMediaApi';
import { useLatestRef } from '@/components/creation-canvas/hooks/useLatestRef';
import { useProjectMediaLibrary, type ProjectMediaLibrary } from './useProjectMediaLibrary';
import type { MediaRequest, MediaReviewDecision } from './mediaRequest';

/**
 * What the agent's image/video tools need from the Media panel — and nothing
 * else. Generating lands the asset in the library; `review` shows it in the panel
 * and resolves with the person's decision. The agent never writes an asset into
 * the app until that decision is "use".
 */
export interface MediaStudioPort {
  generate: (request: MediaRequest) => Promise<ProjectMediaItem>;
  review: (item: ProjectMediaItem) => Promise<MediaReviewDecision>;
  markUsed: (id: string) => Promise<void>;
}

export interface MediaReview {
  item: ProjectMediaItem;
  decide: (decision: MediaReviewDecision) => void;
}

export interface MediaStudio {
  library: ProjectMediaLibrary;
  /** The asset the agent is waiting on a decision for, if any. */
  review: MediaReview | null;
  port: MediaStudioPort;
}

/**
 * The Studio's media: the library plus the review broker. `reveal` brings the
 * Media panel on screen (the workspace's rail) — called whenever the agent asks
 * for a decision, so the question is never asked to a closed panel.
 */
export function useMediaStudio(projectId: number | null, reveal: () => void): MediaStudio {
  const library = useProjectMediaLibrary(projectId);
  const [pending, setPending] = useState<{ item: ProjectMediaItem; resolve: (decision: MediaReviewDecision) => void } | null>(null);
  const pendingRef = useLatestRef(pending);
  const live = useLatestRef({ library, reveal });

  const requestReview = useCallback((item: ProjectMediaItem) => new Promise<MediaReviewDecision>((resolve) => {
    // A second request supersedes an unanswered first: that one is discarded, not left hanging.
    pendingRef.current?.resolve({ action: 'discard' });
    setPending({ item, resolve });
    live.current.reveal();
  }), [live, pendingRef]);

  const decide = useCallback((decision: MediaReviewDecision) => {
    const current = pendingRef.current;
    if (!current) return;
    setPending(null);
    current.resolve(decision);
  }, [pendingRef]);

  const port = useMemo<MediaStudioPort>(() => ({
    generate: (request) => live.current.library.generate(request),
    review: requestReview,
    markUsed: (id) => live.current.library.markUsed(id),
  }), [live, requestReview]);

  return {
    library,
    review: pending ? { item: pending.item, decide } : null,
    port,
  };
}
