/**
 * A page capture's screenshot and rect map, read through the ONE Insights client
 * (PRD 33 §5.2). Screenshots are member-authorised routes, so the image is an
 * object URL from an authenticated fetch (`replayApi.captureAssetUrl`), revoked
 * when the path changes or the component goes away — never a token in a URL.
 */

import { useEffect, useState } from 'react';
import type { PageRect } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';

export interface CaptureImage {
  /** Object URL, or null while loading / when there is no image. */
  src: string | null;
  failed: boolean;
}

function revoke(url: string): void {
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
}

/** The image at a `capturesAsset` path (as the DTOs carry them); null path → no image. */
export function useCaptureImage(path: string | null | undefined): CaptureImage {
  const [state, setState] = useState<CaptureImage>({ src: null, failed: false });
  useEffect(() => {
    setState({ src: null, failed: false });
    if (!path) return undefined;
    let live = true;
    let made: string | null = null;
    replayApi.captureAssetUrl(path)
      .then((url) => {
        made = url;
        if (live) setState({ src: url, failed: false });
        else revoke(url);
      })
      .catch(() => { if (live) setState({ src: null, failed: true }); });
    return () => {
      live = false;
      if (made) revoke(made);
    };
  }, [path]);
  return state;
}

/** Where each element the review saw sits on a capture (empty until read, or without one). */
export function useCaptureRects(siteId: string, captureId: string | null | undefined): PageRect[] {
  const [rects, setRects] = useState<PageRect[]>([]);
  useEffect(() => {
    setRects([]);
    if (!captureId) return undefined;
    let live = true;
    replayApi.captureRects(siteId, captureId)
      .then((found) => { if (live) setRects(found); })
      .catch(() => { if (live) setRects([]); });
    return () => { live = false; };
  }, [siteId, captureId]);
  return rects;
}
