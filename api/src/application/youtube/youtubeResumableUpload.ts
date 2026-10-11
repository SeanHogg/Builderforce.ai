/**
 * Google's resumable upload protocol, as ONE tick of a durable job.
 *
 * This module is the engine and nothing else: no database, no tokens, no R2. It is
 * handed where the upload got to (a {@link YouTubeUploadCursor}), a byte source and an
 * access token, pushes a bounded number of chunks, and answers with what the row
 * should now say ({@link YouTubeUploadTick}). The job layer (`youtubeUploadJobs.ts`)
 * owns claiming, persistence, backoff and write-back; keeping the protocol out of it
 * is what lets the protocol be tested against a stubbed `fetch` alone.
 *
 * ── THE PROTOCOL, AND THE THREE RULES THAT MAKE IT SURVIVE EVICTION ─────────
 *   1. INITIATE once: a POST with the metadata returns a session URI in `Location`.
 *      The URI is stored, never re-initiated while it lives — re-initiating would
 *      upload the whole file again from zero.
 *   2. ASK BEFORE SENDING. A tick that resumes a stored session first PUTs an empty
 *      body with `Content-Range: bytes * /<total>`; the 308's `Range:` header is the
 *      truth about what landed. A tick evicted mid-chunk therefore loses one chunk
 *      and no correctness — our own counter is never trusted over Google's.
 *   3. CHUNK IN 256 KiB MULTIPLES. Every chunk but the last must be a multiple of
 *      {@link YOUTUBE_CHUNK_QUANTUM}; Google rejects anything else. A 308 may also
 *      acknowledge LESS than was sent, so the next chunk starts at the acknowledged
 *      offset, not at the end of what we pushed.
 *
 * A small object finishes in a single chunk — one code path for the five-second clip
 * and the forty-minute launch video.
 */

/** Google's chunk-size multiple: every non-final chunk is a whole number of these. */
export const YOUTUBE_CHUNK_QUANTUM = 256 * 1024;

/** Default chunk: 8 MiB — 32 quanta. Big enough that a tick makes real progress,
 *  small enough that a chunk lost to eviction is cheap to resend. */
export const YOUTUBE_DEFAULT_CHUNK_BYTES = 32 * YOUTUBE_CHUNK_QUANTUM;

const INITIATE_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

/** YouTube's "Science & Technology" category — what a product launch video is. */
const DEFAULT_CATEGORY_ID = '28';

export type YouTubePrivacy = 'private' | 'unlisted' | 'public';

/** What the job row knows about one upload. */
export interface YouTubeUploadCursor {
  uploadUrl: string | null;
  /** Bytes GOOGLE has acknowledged. */
  bytesSent: number;
  /** 0 until the source has been described. */
  byteSize: number;
  mimeType: string;
  title: string;
  description: string;
  privacyStatus: YouTubePrivacy;
}

/** Where the bytes come from. Read in ranges, so R2 and a public URL are the same here. */
export interface YouTubeUploadSource {
  describe(): Promise<{ size: number; contentType: string | null }>;
  read(offset: number, length: number): Promise<ArrayBuffer>;
}

/** A source failure, classified the way the job needs it. */
export class YouTubeUploadSourceError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'YouTubeUploadSourceError';
  }
}

export interface YouTubeUploadTickDeps {
  accessToken: string;
  source: YouTubeUploadSource;
  fetchImpl?: typeof fetch;
  /** Rounded DOWN to a multiple of {@link YOUTUBE_CHUNK_QUANTUM}, never below one. */
  chunkBytes?: number;
  /** Chunks this tick may send before yielding back to the sweep. */
  maxChunks?: number;
}

/** Where the row lands after one tick. Every variant carries the cursor fields to persist. */
export type YouTubeUploadTick =
  | { kind: 'progress'; uploadUrl: string; bytesSent: number; byteSize: number; mimeType: string }
  | { kind: 'succeeded'; uploadUrl: string | null; bytesSent: number; byteSize: number; mimeType: string; videoId: string; privacyStatus: string; processingStatus: string | null }
  /** Transient: try again after backoff, from what Google confirmed. */
  | { kind: 'retry'; uploadUrl: string | null; bytesSent: number; byteSize: number; mimeType: string; error: string }
  /** Terminal: retrying cannot help (rejected token, quota, not a video). */
  | { kind: 'failed'; error: string };

/** Round a requested chunk to Google's multiple. */
export function normalizeChunkBytes(requested: number | undefined): number {
  const quanta = Math.floor((requested ?? YOUTUBE_DEFAULT_CHUNK_BYTES) / YOUTUBE_CHUNK_QUANTUM);
  return Math.max(1, quanta) * YOUTUBE_CHUNK_QUANTUM;
}

/**
 * Bytes acknowledged, from a 308's `Range` header (`bytes=0-524287` → 524288).
 * No header means Google holds nothing yet.
 */
export function acknowledgedBytes(rangeHeader: string | null): number {
  const match = /bytes=0-(\d+)/i.exec(rangeHeader ?? '');
  return match ? Number(match[1]) + 1 : 0;
}

/** 429 and 5xx are worth another attempt; YouTube answers most refusals as 4xx. */
export function isTransientStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

/** 404 / 410 on a session URI: the session expired (about a week) or was discarded. */
const isExpiredSession = (status: number) => status === 404 || status === 410;

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string; errors?: Array<{ reason?: string }> } } | null;
  const reason = body?.error?.errors?.[0]?.reason;
  const message = body?.error?.message;
  return [message || fallback, reason ? `(${reason})` : ''].filter(Boolean).join(' ').slice(0, 500);
}

interface CompletedVideo { videoId: string; privacyStatus: string; processingStatus: string | null }

async function completedVideo(response: Response, fallbackPrivacy: string): Promise<CompletedVideo | null> {
  const body = await response.json().catch(() => ({})) as { id?: string; status?: { privacyStatus?: string; uploadStatus?: string }; processingDetails?: { processingStatus?: string } };
  if (!body.id) return null;
  return {
    videoId: body.id,
    privacyStatus: body.status?.privacyStatus ?? fallbackPrivacy,
    processingStatus: body.processingDetails?.processingStatus ?? body.status?.uploadStatus ?? null,
  };
}

/** What a transport failure (DNS, reset) means: transient, by definition. */
const networkError = (error: unknown) => error instanceof Error ? error.message : 'Network error talking to YouTube.';

/**
 * Advance one upload by at most `maxChunks` chunks.
 *
 * Never throws for a protocol or source failure — every outcome is a
 * {@link YouTubeUploadTick} the job layer can persist.
 */
export async function runYouTubeUploadTick(cursor: YouTubeUploadCursor, deps: YouTubeUploadTickDeps): Promise<YouTubeUploadTick> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const chunkBytes = normalizeChunkBytes(deps.chunkBytes);
  const maxChunks = Math.max(1, deps.maxChunks ?? 4);
  const auth = { Authorization: `Bearer ${deps.accessToken}` };

  let byteSize = cursor.byteSize;
  let mimeType = cursor.mimeType;
  let uploadUrl = cursor.uploadUrl;
  let offset = cursor.bytesSent;
  const retry = (error: string): YouTubeUploadTick => ({ kind: 'retry', uploadUrl, bytesSent: offset, byteSize, mimeType, error });
  const sourceFailure = (error: unknown): YouTubeUploadTick => error instanceof YouTubeUploadSourceError && !error.retryable
    ? { kind: 'failed', error: error.message }
    : retry(error instanceof Error ? error.message : 'The video could not be read.');

  // ── Describe the source once: its size is in every Content-Range header. ──
  if (byteSize <= 0) {
    try {
      const described = await deps.source.describe();
      if (!(described.size > 0)) return { kind: 'failed', error: 'The video is empty.' };
      const type = (described.contentType ?? '').split(';')[0]!.trim().toLowerCase();
      if (type && type !== 'application/octet-stream' && !type.startsWith('video/')) {
        return { kind: 'failed', error: `That media is not a video (${type}). YouTube only accepts video.` };
      }
      byteSize = described.size;
      if (type.startsWith('video/')) mimeType = type;
    } catch (error) {
      return sourceFailure(error);
    }
  }

  // ── Initiate, or ask a stored session where it got to. ──
  const initiate = async (): Promise<YouTubeUploadTick | null> => {
    const metadata = JSON.stringify({
      snippet: { title: cursor.title.slice(0, 100), description: cursor.description.slice(0, 5_000), categoryId: DEFAULT_CATEGORY_ID },
      status: { privacyStatus: cursor.privacyStatus, selfDeclaredMadeForKids: false },
    });
    let response: Response;
    try {
      response = await fetchImpl(INITIATE_URL, {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(byteSize),
          'X-Upload-Content-Type': mimeType,
        },
        body: metadata,
      });
    } catch (error) {
      return retry(networkError(error));
    }
    const location = response.headers.get('Location');
    if (response.ok && location) {
      uploadUrl = location;
      offset = 0;
      return null;
    }
    const message = await errorMessage(response, `YouTube upload could not start (${response.status}).`);
    return isTransientStatus(response.status) ? retry(message) : { kind: 'failed', error: message };
  };

  let freshSession = false;
  if (!uploadUrl) {
    const failed = await initiate();
    if (failed) return failed;
    freshSession = true;
  }

  if (!freshSession) {
    let status: Response;
    try {
      status = await fetchImpl(uploadUrl!, { method: 'PUT', headers: { ...auth, 'Content-Range': `bytes */${byteSize}`, 'Content-Length': '0' } });
    } catch (error) {
      return retry(networkError(error));
    }
    if (status.status === 308) {
      offset = acknowledgedBytes(status.headers.get('Range'));
    } else if (status.ok) {
      const video = await completedVideo(status, cursor.privacyStatus);
      if (video) return { kind: 'succeeded', uploadUrl, bytesSent: byteSize, byteSize, mimeType, ...video };
      return retry('YouTube reported the upload complete without a video id.');
    } else if (isExpiredSession(status.status)) {
      // The session is gone; everything it held is gone with it. Start over.
      uploadUrl = null;
      offset = 0;
      const failed = await initiate();
      if (failed) return failed;
    } else if (isTransientStatus(status.status)) {
      return retry(`YouTube did not answer the resume check (${status.status}).`);
    } else {
      return { kind: 'failed', error: await errorMessage(status, `YouTube refused to resume the upload (${status.status}).`) };
    }
  }

  // ── Push chunks from the acknowledged offset. ──
  for (let sent = 0; sent < maxChunks && offset < byteSize; sent += 1) {
    const end = Math.min(offset + chunkBytes, byteSize);
    let body: ArrayBuffer;
    try {
      body = await deps.source.read(offset, end - offset);
    } catch (error) {
      return sourceFailure(error);
    }
    if (body.byteLength !== end - offset) return retry(`The video source returned ${body.byteLength} bytes where ${end - offset} were asked for.`);

    let response: Response;
    try {
      response = await fetchImpl(uploadUrl!, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': mimeType, 'Content-Length': String(body.byteLength), 'Content-Range': `bytes ${offset}-${end - 1}/${byteSize}` },
        body,
      });
    } catch (error) {
      return retry(networkError(error));
    }

    if (response.status === 308) {
      const acknowledged = acknowledgedBytes(response.headers.get('Range'));
      // No forward motion means something is wrong that resending will not fix in
      // this tick; hand it to backoff rather than spin.
      if (acknowledged <= offset) return retry('YouTube did not acknowledge the last chunk.');
      offset = acknowledged;
      continue;
    }
    if (response.ok) {
      const video = await completedVideo(response, cursor.privacyStatus);
      if (video) return { kind: 'succeeded', uploadUrl, bytesSent: byteSize, byteSize, mimeType, ...video };
      return retry('YouTube finished the upload without returning a video id.');
    }
    if (isExpiredSession(response.status)) {
      uploadUrl = null;
      offset = 0;
      return retry('The YouTube upload session expired; it will restart from the beginning.');
    }
    const message = await errorMessage(response, `YouTube rejected a chunk (${response.status}).`);
    return isTransientStatus(response.status) ? retry(message) : { kind: 'failed', error: message };
  }

  return { kind: 'progress', uploadUrl: uploadUrl!, bytesSent: offset, byteSize, mimeType };
}

/** Whole-number percent of the video Google has confirmed. */
export function uploadPercent(bytesSent: number, byteSize: number): number {
  if (!(byteSize > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((bytesSent / byteSize) * 100)));
}
