/**
 * useYouTubeUpload — drive a resumable YouTube upload while the editor is open.
 *
 * The server owns the upload (`youtube_uploads`): a short render finishes inside the
 * publish call, a long one comes back `uploading`. While this tab is open it asks the
 * server for one more chunk tick at a time, so a launch video goes up at network speed
 * rather than once per cron tick. The upload id is persisted on the `video` object by
 * the caller, so closing the tab stops DRIVING, not uploading — the sweep finishes it,
 * and whoever opens the object next picks the job back up and lands its link.
 */

import { useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/apiClient';
import { youtubeApi, type YouTubeUpload } from '@/lib/youtubeApi';
import { useLatestRef } from '@/components/creation-canvas/hooks/useLatestRef';

/** Pause between ticks. A tick itself sends several MiB, so this is breathing room. */
const NEXT_TICK_MS = 1_500;
/** After a failed request (offline, 5xx): back off rather than hammer. */
const RETRY_AFTER_MS = 10_000;

export interface UseYouTubeUploadResult {
  /** Confirmed percent while an upload is in flight, otherwise null. */
  percent: number | null;
}

export function useYouTubeUpload(
  uploadId: string | null,
  onSettled: (upload: YouTubeUpload) => void,
): UseYouTubeUploadResult {
  const [percent, setPercent] = useState<number | null>(null);
  const settled = useLatestRef(onSettled);

  useEffect(() => {
    if (!uploadId) { setPercent(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPercent(0);
    const tick = async () => {
      try {
        const { upload } = await youtubeApi.advance(uploadId);
        if (cancelled) return;
        if (upload.state === 'succeeded' || upload.state === 'failed') {
          setPercent(null);
          settled.current(upload);
          return;
        }
        setPercent(upload.percent);
        timer = setTimeout(() => { void tick(); }, NEXT_TICK_MS);
      } catch (caught) {
        if (cancelled) return;
        // The upload is gone (or was never this person's): stop driving it for good.
        if (caught instanceof ApiRequestError && caught.status === 404) {
          setPercent(null);
          settled.current({ id: uploadId, state: 'failed', percent: 0, bytesSent: 0, byteSize: 0, videoId: null, url: null, privacyStatus: '', error: caught.message });
          return;
        }
        timer = setTimeout(() => { void tick(); }, RETRY_AFTER_MS);
      }
    };
    void tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [uploadId, settled]);

  return { percent };
}
