import { describe, expect, it } from 'vitest';
import { audioMimeFor, buildPodcastFeed, podcastChaptersJson, renderPodcastRss, type PodcastFeedSpec } from './podcastRss';

const spec: PodcastFeedSpec = {
  title: 'Tom & Jerry <Live>', description: 'He said "hi" & left', link: 'https://example.com', imageUrl: 'https://example.com/a.jpg',
  author: 'Ann', ownerEmail: 'ann@example.com', category: 'Technology', language: 'en-us', explicit: false, feedUrl: 'https://example.com/feed.xml',
};
const episode = {
  guid: 'ep-1', title: "It's 5 > 3", description: 'Notes', audioUrl: 'https://cdn.example/a.mp3?x=1&y=2', audioBytes: 1234, audioMime: 'audio/mpeg',
  durationSec: 3725, pubDate: new Date('2026-11-01T10:00:00Z'),
};

describe('renderPodcastRss', () => {
  it('escapes XML metacharacters in text and attributes', () => {
    const xml = renderPodcastRss(spec, [episode]);
    expect(xml).toContain('<title>Tom &amp; Jerry &lt;Live&gt;</title>');
    expect(xml).toContain('<description>He said &quot;hi&quot; &amp; left</description>');
    expect(xml).toContain('<title>It&apos;s 5 &gt; 3</title>');
    expect(xml).not.toContain('Tom & Jerry');
  });

  it('declares the itunes, atom and podcast namespaces and the show tags', () => {
    const xml = renderPodcastRss(spec, []);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"');
    expect(xml).toContain('<atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml"/>');
    expect(xml).toContain('<itunes:explicit>no</itunes:explicit>');
    expect(xml).toContain('<itunes:image href="https://example.com/a.jpg"/>');
    expect(xml).toContain('<itunes:email>ann@example.com</itunes:email>');
    expect(xml).toContain('<itunes:category text="Technology"/>');
  });

  it('nests a subcategory', () => {
    const xml = renderPodcastRss({ ...spec, subcategory: 'Tech News' }, []);
    expect(xml).toContain('<itunes:category text="Technology">\n      <itunes:category text="Tech News"/>');
  });

  it('writes the enclosure, duration, guid and an RFC-822 date', () => {
    const xml = renderPodcastRss(spec, [{ ...episode, season: 2, episodeNumber: 7 }]);
    expect(xml).toContain('<enclosure url="https://cdn.example/a.mp3?x=1&amp;y=2" length="1234" type="audio/mpeg"/>');
    expect(xml).toContain('<itunes:duration>1:02:05</itunes:duration>');
    expect(xml).toContain('<guid isPermaLink="false">ep-1</guid>');
    expect(xml).toContain('<pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate>');
    expect(xml).toContain('<itunes:season>2</itunes:season>');
    expect(xml).toContain('<itunes:episode>7</itunes:episode>');
  });

  it('carries chapters in the Podcast 2.0 namespace', () => {
    const chapters = [{ startTimeSec: 0, title: 'Intro' }, { startTimeSec: 90, title: 'Main' }];
    const xml = renderPodcastRss(spec, [{ ...episode, chapters }]);
    const hosted = renderPodcastRss(spec, [{ ...episode, chapters, chaptersUrl: 'https://cdn.example/ch.json' }]);
    expect(hosted).toContain('<podcast:chapters url="https://cdn.example/ch.json" type="application/json+chapters"/>');
    // Chapters without a hosted URL, or with a data: / blob: one, never produce the tag.
    expect(renderPodcastRss(spec, [{ ...episode, chapters }])).not.toContain('podcast:chapters');
    expect(renderPodcastRss(spec, [{ ...episode, chapters, chaptersUrl: 'data:application/json,{}' }])).not.toContain('podcast:chapters');
    expect(JSON.parse(podcastChaptersJson(chapters))).toEqual({ version: '1.2.0', chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 90, title: 'Main' }] });
    expect(renderPodcastRss(spec, [episode])).not.toContain('podcast:chapters');
  });
});

describe('audioMimeFor', () => {
  it('reads the type from the file name, then the source, then defaults to MP3', () => {
    expect(audioMimeFor('https://x/y.m4a?sig=1')).toBe('audio/x-m4a');
    expect(audioMimeFor('https://x/y.WAV')).toBe('audio/wav');
    expect(audioMimeFor('https://x/stream', 'audio/ogg')).toBe('audio/ogg');
    expect(audioMimeFor('https://x/stream', 'video/mp4')).toBe('audio/mpeg');
  });
});

describe('buildPodcastFeed', () => {
  const timeline = { version: 1, fps: 30, width: 1920, height: 1080, clips: [
    { id: 'c1', sourceId: 's1', track: 'voiceover', startSeconds: 0, durationSeconds: 60, trimStartSeconds: 0, volume: 1, label: 'Intro', chapterTitle: 'Welcome' },
  ] };
  const sources = [{ id: 's1', kind: 'audio', captureKind: 'import', url: 'https://cdn.example/ep1.mp3', fileName: 'ep1.mp3', mimeType: 'audio/mpeg', durationSeconds: 60 }];
  const complete = {
    title: 'Episode One', podcastTimeline: timeline, podcastSources: sources,
    podcastShow: { title: 'The Show', link: 'https://example.com', imageUrl: 'https://example.com/cover.jpg', ownerEmail: 'a@b.co', author: 'Ann' },
    podcastEpisode: { description: 'First one', publishedAt: '2026-10-01T00:00:00Z', audioBytes: 4096 },
  };
  const now = new Date('2026-11-08T00:00:00Z');

  it('builds a feed from a lone public segment, with its chapters', () => {
    const result = buildPodcastFeed(complete, 'builderforce:abc', now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain('<enclosure url="https://cdn.example/ep1.mp3" length="4096" type="audio/mpeg"/>');
    expect(result.xml).toContain('<guid isPermaLink="false">builderforce:abc</guid>');
    expect(result.xml).toContain('<pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate>');
    // No hosted chapters URL was given, so no chapters tag (and never a data: URL).
    expect(result.xml).not.toContain('podcast:chapters');
    expect(result.xml).not.toContain('data:');
  });

  it('writes the chapters tag when a hosted chapters URL is supplied', () => {
    const result = buildPodcastFeed(complete, 'g', now, { chaptersUrl: 'https://cdn.example/ch.json' });
    expect(result.ok && result.xml).toContain('<podcast:chapters url="https://cdn.example/ch.json"');
  });

  it('reports an unknown enclosure length instead of writing length="0"', () => {
    const unknown = { ...complete, podcastEpisode: { description: 'First one' } };
    expect(buildPodcastFeed(unknown, 'g', now)).toEqual({ ok: false, problems: ['noEnclosureLength'] });
    const supplied = buildPodcastFeed(unknown, 'g', now, { enclosureBytes: 2048 });
    expect(supplied.ok && supplied.xml).toContain('length="2048"');
  });

  it('uses the export time when no publication date is set', () => {
    const result = buildPodcastFeed({ ...complete, podcastEpisode: {} }, 'g', now);
    expect(result.ok && result.xml).toContain('Sun, 08 Nov 2026 00:00:00 GMT');
  });

  it('refuses an enclosure a podcast app could not fetch', () => {
    const inline = { ...complete, podcastSources: [{ ...sources[0]!, url: 'data:audio/mpeg;base64,AAAA' }] };
    expect(buildPodcastFeed(inline, 'g', now)).toEqual({ ok: false, problems: ['noEnclosure'] });
    const blob = { ...complete, podcastEpisode: { audioUrl: 'blob:https://x/1' }, podcastSources: inline.podcastSources };
    expect(buildPodcastFeed(blob, 'g', now)).toEqual({ ok: false, problems: ['noEnclosure'] });
  });

  it('needs the published master once there is more than one segment', () => {
    const two = { ...complete, podcastTimeline: { ...timeline, clips: [...timeline.clips, { ...timeline.clips[0]!, id: 'c2', startSeconds: 60 }] } };
    expect(buildPodcastFeed(two, 'g', now)).toEqual({ ok: false, problems: ['noEnclosure'] });
    const published = { ...two, podcastEpisode: { audioUrl: 'https://cdn.example/master.m4a', audioBytes: 99 } };
    const result = buildPodcastFeed(published, 'g', now);
    expect(result.ok && result.xml).toContain('type="audio/x-m4a"');
  });

  it('lists every missing requirement at once', () => {
    expect(buildPodcastFeed({}, 'g', now)).toEqual({ ok: false, problems: ['noSegments', 'noEnclosure', 'noShowTitle', 'noOwnerEmail', 'noImage', 'noLink'] });
  });
});
