/**
 * The two places an upload's bytes come from, behind ONE ranged-read interface.
 *
 * A canvas render lives in R2 under the tenant's prefix; a campaign's media is a
 * public https URL (the same URL Instagram and TikTok pull). The upload engine reads
 * both in chunk-sized ranges and never holds the whole video, so a source is just
 * "how big, what type, and give me bytes [offset, offset+length)".
 */

import { fetchPublic } from '../../infrastructure/net/fetchPublic';
import { assertSafeUrl } from '../../infrastructure/net/ssrfGuard';
import { YouTubeUploadSourceError, type YouTubeUploadSource } from './youtubeResumableUpload';

/** An object in the uploads bucket, read with R2 ranged gets. */
export function r2UploadSource(bucket: R2Bucket | undefined, key: string): YouTubeUploadSource {
  return {
    async describe() {
      if (!bucket) throw new YouTubeUploadSourceError('Video storage is not configured on this deployment.', false);
      const head = await bucket.head(key);
      if (!head) throw new YouTubeUploadSourceError('Video artifact not found.', false);
      return { size: head.size, contentType: head.httpMetadata?.contentType ?? null };
    },
    async read(offset, length) {
      if (!bucket) throw new YouTubeUploadSourceError('Video storage is not configured on this deployment.', false);
      const object = await bucket.get(key, { range: { offset, length } });
      if (!object) throw new YouTubeUploadSourceError('Video artifact not found.', false);
      return object.arrayBuffer();
    },
  };
}

/** `Content-Range: bytes 0-0/1234` → 1234. */
function totalFromContentRange(header: string | null): number {
  const match = /\/(\d+)\s*$/.exec(header ?? '');
  return match ? Number(match[1]) : 0;
}

/**
 * A public https URL, read with `Range` requests through the SSRF-guarded fetch.
 * A 4xx is terminal (the media is gone or private); a 5xx is worth another tick.
 */
export function urlUploadSource(url: string, fetchImpl?: typeof fetch): YouTubeUploadSource {
  const guarded = (init: RequestInit) => {
    try {
      assertSafeUrl(url);
    } catch {
      throw new YouTubeUploadSourceError('That media URL is not a public https address.', false);
    }
    return fetchPublic(url, init, fetchImpl ? { fetchImpl } : {});
  };
  const refuse = (status: number, what: string) => new YouTubeUploadSourceError(
    `The video could not be ${what} (${status}).`,
    status === 429 || status >= 500,
  );

  return {
    async describe() {
      // A one-byte ranged GET answers size and type in one request on every host
      // that honours Range — and HEAD is the one verb some CDNs refuse.
      const probe = await guarded({ method: 'GET', headers: { Range: 'bytes=0-0' } });
      const contentType = probe.headers.get('Content-Type');
      if (probe.status === 206) {
        await probe.body?.cancel();
        return { size: totalFromContentRange(probe.headers.get('Content-Range')), contentType };
      }
      await probe.body?.cancel();
      if (!probe.ok) throw refuse(probe.status, 'read');
      // A 200 means the host ignored Range: ranged reads would be whole-file reads.
      throw new YouTubeUploadSourceError('The media host does not support ranged reads, so the video cannot be uploaded in chunks.', false);
    },
    async read(offset, length) {
      const response = await guarded({ method: 'GET', headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (response.status !== 206) {
        await response.body?.cancel();
        throw refuse(response.status, 'read');
      }
      return response.arrayBuffer();
    },
  };
}
