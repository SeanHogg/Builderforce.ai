import { apiRequest } from '@/lib/apiClient';
import { AUTH_API_URL } from '@/lib/auth';
import { isGuestSession } from '../exportArtifact';
import { podcastEpisodeFrom, podcastSegments, podcastStateFrom } from './podcastEpisode';

/**
 * Public, long-lived URLs for a podcast feed's audio and chapters.
 *
 * A podcast app cannot authenticate, and an ordinary signed link lasts ten minutes, so the
 * feed asks the API for a PUBLISH signature (`POST /api/brain/uploads/sign` with
 * `purpose: 'publish'`; years-long, audio and chapters files only, tenant-checked).
 * SECURITY TRADE-OFF: the resulting link is deliberately public and unguessable, and can
 * only be revoked by deleting the object.
 */
export async function publishUrl(storageKey: string): Promise<string> {
  const signed = await apiRequest<{ exp: number; sig: string }>('/api/brain/uploads/sign', {
    method: 'POST', body: JSON.stringify({ key: storageKey, purpose: 'publish' }),
  });
  return `${AUTH_API_URL}/api/brain-files/${storageKey}?exp=${signed.exp}&sig=${encodeURIComponent(signed.sig)}`;
}

/**
 * The object with its lone hosted segment's URL swapped for a publish URL, so the feed's
 * `<enclosure>` is fetchable by a podcast app. A hand-typed external master URL is used
 * as-is, and so is the object when there is nothing to publish (a guest, a segment with no
 * stored file, a signing refusal): the feed then reports what it cannot fetch.
 */
export async function withPublishedEnclosure<T extends Readonly<Record<string, unknown>>>(data: T): Promise<T> {
  if (/^https?:\/\//i.test(podcastEpisodeFrom(data.podcastEpisode).audioUrl) || isGuestSession()) return data;
  const { timeline, sources } = podcastStateFrom(data);
  const segments = podcastSegments(timeline, sources);
  const lone = segments.length === 1 ? segments[0]!.source : null;
  if (!lone?.storageKey) return data;
  try {
    const url = await publishUrl(lone.storageKey);
    return { ...data, podcastSources: sources.map((source) => (source.id === lone.id ? { ...source, url } : source)) };
  } catch {
    return data;
  }
}
