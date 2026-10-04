/**
 * MediaRenderContainerDO — the Cloudflare Container that renders a canvas video
 * timeline to MP4 with ffmpeg (image at `api/media-render`). Paid plans only: it
 * is what lets a movie finish with the browser tab closed.
 *
 * `MediaJobDO` POSTs the resolved render request (fetchable URLs, never tenant
 * credentials) to `/render` and receives the MP4 bytes in the response; the job
 * stores them in the tenant's R2. One instance per job
 * (`idFromName('media-render:<jobId>')`).
 */
import { Container } from '@cloudflare/containers';
import type { Env } from '../../env';

export class MediaRenderContainerDO extends Container<Env> {
  /** The container's HTTP server listens here (see media-render/server.mjs). */
  defaultPort = 8080;

  /** A render is one-shot per job; a short keep-warm window bounds idle billing. */
  sleepAfter = '2m';

  /** The renderer downloads each clip from its public URL. */
  enableInternet = true;

  override async onError(error: unknown): Promise<unknown> {
    console.error('[MediaRenderContainerDO] container error', error);
    return error;
  }
}
