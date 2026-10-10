/**
 * "Publish this render to YouTube" from the canvas video editor.
 *
 * There used to be a single-shot PUT here: stream the whole R2 object into Google's
 * resumable session in one request. It worked exactly as long as the object fit one
 * request's budget, and a long render failed with nothing to resume. Now the editor's
 * button queues the same durable job a campaign queues and runs its first tick inline:
 * a short clip still finishes inside this call, and a long one comes back `uploading`
 * with a percent, finished by the editor's own polling or, with the tab closed, by the
 * sweep. One uploader, one code path.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { YouTubePrivacy } from './youtubeResumableUpload';
import {
  advanceYouTubeUpload,
  enqueueYouTubeUpload,
  YouTubeUploadError,
  youtubeUploadView,
  type YouTubeUploadView,
} from './youtubeUploadJobs';

export interface PublishYouTubeInput {
  connectionId: number;
  storageKey: string;
  title: string;
  description?: string;
  privacyStatus: YouTubePrivacy;
  mimeType: string;
}

/** Chunks the request that queues the upload may send before answering. 4 × 8 MiB
 *  covers a typical canvas render; anything longer is handed to the sweep. */
export const CANVAS_INLINE_CHUNKS = 4;

export async function publishCanvasVideoToYouTube(
  db: Db, env: Env, tenantId: number, userId: string, input: PublishYouTubeInput,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<YouTubeUploadView> {
  // Checked BEFORE a row exists: a key outside the caller's prefix, or one that is not
  // there, is "not found" — never a queued job that fails later.
  if (!input.storageKey.startsWith(`${tenantId}/`)) throw new YouTubeUploadError('Video artifact not found.', 404);
  const head = await env.UPLOADS?.head(input.storageKey);
  if (!head) throw new YouTubeUploadError('Video artifact not found.', 404);

  const queued = await enqueueYouTubeUpload(db, env, {
    tenantId, userId, connectionId: input.connectionId,
    source: { storageKey: input.storageKey },
    mimeType: input.mimeType,
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    privacyStatus: input.privacyStatus,
  });
  const advanced = await advanceYouTubeUpload(db, env, queued, {
    maxChunks: CANVAS_INLINE_CHUNKS,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  return youtubeUploadView(advanced);
}
