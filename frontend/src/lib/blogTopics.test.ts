import { describe, it, expect } from 'vitest';
import { BLOG_POSTS } from './blogData';
import {
  BLOG_TOPICS,
  FALLBACK_TOPIC,
  filterPosts,
  isBlogTopic,
  matchesQuery,
  topTagsFor,
  topicCounts,
  topicOf,
} from './blogTopics';

/**
 * The topic registry is a MATCHER over free-form front-matter tags, so the two
 * ways it can rot are both silent in the product:
 *
 *  1. A topic anchored on a tag no article carries — a chip that would select
 *     nothing, kept alive by the fact that nothing renders it until it does.
 *  2. Articles piling into the `more` catch-all, which looks like a topic and
 *     reads like a shrug.
 *
 * Both are assertions rather than review notes, because the corpus grows by a
 * Markdown file with a `tags:` line and nothing about that act reaches this file.
 */
describe('blog topics', () => {
  const declared = BLOG_TOPICS.flatMap((topic) => topic.tags);
  const live = new Set(BLOG_POSTS.flatMap((post) => post.tags));

  it('anchors every topic on tags the corpus actually carries', () => {
    const dead = declared.filter((tag) => !live.has(tag)).sort();
    expect(dead).toEqual([]);
  });

  it('files each anchor tag under exactly one topic', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const topic of BLOG_TOPICS) {
      for (const tag of topic.tags) {
        const owner = seen.get(tag);
        if (owner) clashes.push(`${tag}: ${owner} / ${topic.id}`);
        else seen.set(tag, topic.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('resolves every article to a real topic', () => {
    const orphans = BLOG_POSTS.filter((post) => topicOf(post) === FALLBACK_TOPIC).map((p) => p.slug);
    expect(orphans).toEqual([]);
  });

  it('gives every non-empty topic a chip worth pressing', () => {
    const counts = topicCounts(BLOG_POSTS);
    // Sums back to the corpus: no article counted twice, none dropped.
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(BLOG_POSTS.length);
    expect(Object.keys(counts).every(isBlogTopic)).toBe(true);
  });

  it('narrows on every search term rather than widening', () => {
    const post = BLOG_POSTS.find((p) => p.title.toLowerCase().includes('diagram'));
    expect(post).toBeDefined();
    expect(matchesQuery(post!, 'diagram')).toBe(true);
    expect(matchesQuery(post!, '   ')).toBe(true);
    // A second term that appears nowhere must exclude the post, not be ignored.
    expect(matchesQuery(post!, 'diagram zzzznotaword')).toBe(false);
  });

  it('derives tag chips only from tags the filtered set carries', () => {
    const topic = BLOG_TOPICS.find((entry) => topicCounts(BLOG_POSTS)[entry.id] > 3);
    expect(topic).toBeDefined();
    const inTopic = BLOG_POSTS.filter((post) => topicOf(post) === topic!.id);
    for (const tag of topTagsFor(inTopic)) {
      expect(filterPosts(inTopic, { tag }).length).toBeGreaterThan(0);
    }
  });

  it('applies topic, tag and query together', () => {
    const topic = BLOG_TOPICS.find((entry) => topicCounts(BLOG_POSTS)[entry.id] > 3)!.id;
    const inTopic = filterPosts(BLOG_POSTS, { topic });
    expect(inTopic.length).toBeGreaterThan(0);
    expect(inTopic.every((post) => topicOf(post) === topic)).toBe(true);
    expect(filterPosts(BLOG_POSTS, { topic, query: 'zzzznotaword' })).toEqual([]);
  });
});
