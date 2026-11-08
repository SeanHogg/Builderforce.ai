'use client';

import { useEffect, useState } from 'react';
import { fetchCanvasMediaBlob } from '@/lib/canvasMediaStore';
import { isAuthedMediaUrl } from '@/lib/loadAuthedImage';

export interface AuthedMediaUrl {
  /** What to put in `src`: the object URL for an authenticated upload (once fetched), else the URL itself. */
  url: string | undefined;
  loading: boolean;
  error: boolean;
}

/**
 * A URL an `<img>`/`<video>`/`<audio>` can actually load. Tenant-authenticated uploads
 * (`/api/brain/uploads/<key>`) need the bearer token, which a media element cannot send, so they
 * are fetched through `fetchCanvasMediaBlob` and handed back as an object URL, revoked when the
 * URL changes or the component unmounts. data:, blob: and every other URL pass through unchanged.
 */
export function useAuthedMediaUrl(source: string | null | undefined): AuthedMediaUrl {
  const needsFetch = !!source && isAuthedMediaUrl(source);
  const [fetched, setFetched] = useState<{ source: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!source || !needsFetch) return undefined;
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(null);
    fetchCanvasMediaBlob(source)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setFetched({ source, url: objectUrl });
      })
      .catch(() => { if (!cancelled) setFailed(source); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, needsFetch]);

  if (!source) return { url: undefined, loading: false, error: false };
  if (!needsFetch) return { url: source, loading: false, error: false };
  if (fetched?.source === source) return { url: fetched.url, loading: false, error: false };
  if (failed === source) return { url: undefined, loading: false, error: true };
  return { url: undefined, loading: true, error: false };
}
