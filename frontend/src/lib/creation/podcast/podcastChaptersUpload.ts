import { uploadCanvasFile } from '@/lib/canvasMediaStore';
import { isGuestSession } from '../exportArtifact';
import { podcastChaptersJson } from './podcastRss';
import type { PodcastChapter } from './podcastEpisode';
import { publishUrl } from './podcastPublish';

/** The Podcast 2.0 chapters file's media type. */
export const CHAPTERS_MIME = 'application/json+chapters';

/**
 * Upload the chapters JSON and return a PUBLIC URL (`publishUrl`) for the feed's
 * `<podcast:chapters>` tag. A guest has nowhere to host it, and a failed upload or
 * signature is not worth failing the feed over: all give undefined and the feed simply
 * carries no chapters tag.
 */
export async function uploadPodcastChapters(chapters: readonly PodcastChapter[]): Promise<string | undefined> {
  if (!chapters.length || isGuestSession()) return undefined;
  try {
    const uploaded = await uploadCanvasFile(new File([podcastChaptersJson(chapters)], 'chapters.json', { type: CHAPTERS_MIME }));
    return uploaded ? await publishUrl(uploaded.storageKey) : undefined;
  } catch {
    return undefined;
  }
}
