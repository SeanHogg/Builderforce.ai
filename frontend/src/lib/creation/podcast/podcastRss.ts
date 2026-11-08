/**
 * Podcast RSS 2.0 feed generation (Apple Podcasts / Spotify read the same feed).
 *
 * Ported from the hired.video encoder (`shared/podcast-rss.ts`) and fitted to this
 * product's episode model: one pure function that renders a feed, plus
 * {@link buildPodcastFeed}, which validates what the object holds and refuses to emit a
 * feed a directory would reject — most importantly an enclosure that is not a public
 * http(s) audio URL (a `data:` or `blob:` URL is not something a podcast app can fetch).
 *
 * Standard iTunes tags (author, image, category, explicit, duration, season, episode),
 * an `<enclosure>` per episode, and chapters through the Podcast 2.0 namespace.
 */
import { escapeXml } from '@builderforce/creation-canvas-contract';
import {
  clockTime,
  podcastChapters,
  podcastDuration,
  podcastEpisodeFrom,
  podcastSegments,
  podcastShowFrom,
  podcastStateFrom,
  type PodcastChapter,
} from './podcastEpisode';

export interface PodcastFeedSpec {
  title: string;
  description: string;
  link: string;
  imageUrl: string;
  author: string;
  ownerEmail: string;
  ownerName?: string;
  category: string;
  subcategory?: string;
  language: string;
  explicit: boolean;
  copyright?: string;
  /** Where this XML is hosted — `<atom:link rel="self">`. */
  feedUrl: string;
}

export interface PodcastFeedEpisode {
  /** Stable and permanent: directories dedupe on it. */
  guid: string;
  title: string;
  description: string;
  audioUrl: string;
  audioBytes: number;
  audioMime: string;
  durationSec: number;
  pubDate: Date;
  season?: number;
  episodeNumber?: number;
  imageUrl?: string;
  chapters?: readonly PodcastChapter[];
  /**
   * Where the served chapters JSON ({@link podcastChaptersJson}) is hosted. The
   * `<podcast:chapters>` tag is written ONLY for a public http(s) URL: an inline
   * `data:` URL is not something a podcast app can fetch.
   */
  chaptersUrl?: string;
}

/** Podcast 2.0 chapters JSON, as served alongside the feed. */
export function podcastChaptersJson(chapters: readonly PodcastChapter[]): string {
  return JSON.stringify({ version: '1.2.0', chapters: chapters.map((chapter) => ({ startTime: chapter.startTimeSec, title: chapter.title })) });
}

const PUBLIC_URL = /^https?:\/\//i;

export function renderPodcastRss(spec: PodcastFeedSpec, episodes: readonly PodcastFeedEpisode[]): string {
  const e = escapeXml;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:podcast="https://podcastindex.org/namespace/1.0">',
    '  <channel>',
    `    <title>${e(spec.title)}</title>`,
    `    <link>${e(spec.link)}</link>`,
    `    <description>${e(spec.description)}</description>`,
    `    <language>${e(spec.language)}</language>`,
  ];
  if (spec.copyright) lines.push(`    <copyright>${e(spec.copyright)}</copyright>`);
  lines.push(
    `    <atom:link href="${e(spec.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    `    <itunes:author>${e(spec.author)}</itunes:author>`,
    `    <itunes:summary>${e(spec.description)}</itunes:summary>`,
    `    <itunes:explicit>${spec.explicit ? 'yes' : 'no'}</itunes:explicit>`,
    `    <itunes:image href="${e(spec.imageUrl)}"/>`,
    '    <itunes:owner>',
    `      <itunes:name>${e(spec.ownerName ?? spec.author)}</itunes:name>`,
    `      <itunes:email>${e(spec.ownerEmail)}</itunes:email>`,
    '    </itunes:owner>',
  );
  if (spec.subcategory) {
    lines.push(`    <itunes:category text="${e(spec.category)}">`, `      <itunes:category text="${e(spec.subcategory)}"/>`, '    </itunes:category>');
  } else {
    lines.push(`    <itunes:category text="${e(spec.category)}"/>`);
  }

  for (const episode of episodes) {
    lines.push(
      '    <item>',
      `      <guid isPermaLink="false">${e(episode.guid)}</guid>`,
      `      <title>${e(episode.title)}</title>`,
      `      <description>${e(episode.description)}</description>`,
      `      <itunes:summary>${e(episode.description)}</itunes:summary>`,
      `      <pubDate>${episode.pubDate.toUTCString()}</pubDate>`,
      `      <enclosure url="${e(episode.audioUrl)}" length="${episode.audioBytes}" type="${e(episode.audioMime)}"/>`,
      `      <itunes:duration>${clockTime(episode.durationSec, true)}</itunes:duration>`,
    );
    if (episode.season !== undefined) lines.push(`      <itunes:season>${episode.season}</itunes:season>`);
    if (episode.episodeNumber !== undefined) lines.push(`      <itunes:episode>${episode.episodeNumber}</itunes:episode>`);
    if (episode.imageUrl) lines.push(`      <itunes:image href="${e(episode.imageUrl)}"/>`);
    if (episode.chaptersUrl && PUBLIC_URL.test(episode.chaptersUrl)) {
      lines.push(`      <podcast:chapters url="${e(episode.chaptersUrl)}" type="application/json+chapters"/>`);
    }
    lines.push('    </item>');
  }
  lines.push('  </channel>', '</rss>');
  return lines.join('\n');
}

export type PodcastFeedProblem = 'noSegments' | 'noEnclosure' | 'noEnclosureLength' | 'noShowTitle' | 'noOwnerEmail' | 'noImage' | 'noLink';
export type PodcastFeedResult = { ok: true; xml: string } | { ok: false; problems: PodcastFeedProblem[] };

/** Audio type from the file name (a published master has one), else the source's own, else MP3. */
export function audioMimeFor(url: string, fallback = ''): string {
  const extension = /\.([a-z0-9]+)(?:$|[?#])/i.exec(url)?.[1]?.toLowerCase();
  const byExtension: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/x-m4a', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' };
  return (extension && byExtension[extension]) || (fallback.startsWith('audio/') ? fallback : 'audio/mpeg');
}

/**
 * The feed for ONE podcast object: the show's settings, this episode's metadata and its
 * chapters. `guid` must be permanent (the object id); `now` stands in for an unset
 * publication date so the function stays pure.
 *
 * `enclosureBytes` is the stored file size of the audio the enclosure points at, when the
 * caller knows it; it wins over the episode's own `audioBytes`. The enclosure `length` is
 * required by RSS, so a feed with no known size is reported as `noEnclosureLength`.
 * `chaptersUrl` is the hosted chapters JSON; without it the feed carries no chapters tag.
 */
export function buildPodcastFeed(
  data: Readonly<Record<string, unknown>>,
  guid: string,
  now: Date,
  extras: { enclosureBytes?: number; chaptersUrl?: string } = {},
): PodcastFeedResult {
  const show = podcastShowFrom(data.podcastShow);
  const episode = podcastEpisodeFrom(data.podcastEpisode);
  const { timeline, sources } = podcastStateFrom(data);
  const segments = podcastSegments(timeline, sources);
  const title = typeof data.title === 'string' ? data.title : '';

  const lone = segments.length === 1 ? segments[0]!.source : null;
  const enclosureUrl = PUBLIC_URL.test(episode.audioUrl) ? episode.audioUrl : lone && PUBLIC_URL.test(lone.url) ? lone.url : '';

  const known = (value: number | undefined): number | undefined => (value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined);
  const audioBytes = known(extras.enclosureBytes) ?? known(episode.audioBytes);

  const problems: PodcastFeedProblem[] = [];
  if (!segments.length) problems.push('noSegments');
  if (!enclosureUrl) problems.push('noEnclosure');
  else if (audioBytes === undefined) problems.push('noEnclosureLength');
  if (!(show.title || title)) problems.push('noShowTitle');
  if (!show.ownerEmail) problems.push('noOwnerEmail');
  if (!PUBLIC_URL.test(show.imageUrl)) problems.push('noImage');
  if (!PUBLIC_URL.test(show.link)) problems.push('noLink');
  if (problems.length) return { ok: false, problems };

  const chapters = podcastChapters(timeline);
  const feedEpisode: PodcastFeedEpisode = {
    guid,
    title,
    description: episode.description,
    audioUrl: enclosureUrl,
    audioBytes: audioBytes!,
    audioMime: audioMimeFor(enclosureUrl, lone?.mimeType),
    durationSec: podcastDuration(timeline),
    pubDate: episode.publishedAt ? new Date(episode.publishedAt) : now,
    ...(episode.season !== undefined ? { season: episode.season } : {}),
    ...(episode.episodeNumber !== undefined ? { episodeNumber: episode.episodeNumber } : {}),
    ...(chapters.length ? { chapters } : {}),
    ...(chapters.length && extras.chaptersUrl ? { chaptersUrl: extras.chaptersUrl } : {}),
  };
  const spec: PodcastFeedSpec = {
    title: show.title || title,
    description: show.description || episode.description,
    link: show.link,
    imageUrl: show.imageUrl,
    author: show.author || episode.author,
    ownerEmail: show.ownerEmail,
    category: show.category,
    language: show.language,
    explicit: show.explicit || episode.explicit,
    feedUrl: show.feedUrl || show.link,
  };
  return { ok: true, xml: renderPodcastRss(spec, [feedEpisode]) };
}
