import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { BrainTimeline, TIMELINE_PAGE_SIZE } from './BrainTimeline';
import { renderRange } from './timeline/useRenderWindow';

const msg = (id: number): BrainMessage => ({
  id, seq: id, role: id % 2 ? 'user' : 'assistant', content: `message ${id}`, metadata: null,
  createdAt: new Date(1_700_000_000_000 + id * 1000).toISOString(),
});
const many = (n: number) => Array.from({ length: n }, (_, i) => msg(i + 1));
const render = (messages: BrainMessage[], revealMessage: { id: number; nonce: number } | null = null) =>
  renderToStaticMarkup(
    <BrainTimeline
      messages={messages}
      trace={[]}
      streamingText=""
      isRunning={false}
      revealMessage={revealMessage}
      conversationKey={1}
      labels={{ showEarlier: 'Earlier ({count})', showNewer: 'Newer ({count})', jumpToLatest: 'Latest' }}
    />,
  );
/** One row per rendered node: each carries its `bf-msg-{id}` anchor. */
const shownIds = (html: string) => [...html.matchAll(/id="bf-msg-(\d+)"/g)].map((m) => Number(m[1]));
const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`);
const P = TIMELINE_PAGE_SIZE;

describe('<BrainTimeline> render window', () => {
  it('renders every node of a short chat and offers no paging', () => {
    const html = render(many(10));
    expect(shownIds(html)).toHaveLength(10);
    expect(html).not.toContain('bf-tl-earlier');
  });

  it('renders only the newest page of a long chat, with a button for the next page', () => {
    const html = render(many(P + 400));
    const ids = shownIds(html);
    expect(ids).toHaveLength(P);
    expect(ids).toContain(P + 400);
    expect(ids).not.toContain(1);
    expect(html).toContain(`Earlier (${P})`);
    expect(html).not.toContain('Latest');
  });

  it('labels the last partial page with what is actually left', () => {
    expect(render(many(P + 12))).toContain('Earlier (12)');
  });

  it('reveals an old message as a page AROUND it, not everything up to the newest', () => {
    const html = render(many(P * 30), { id: 60, nonce: 1 });
    const ids = shownIds(html);
    expect(ids).toContain(60);
    expect(ids.length).toBeLessThanOrEqual(P);
    expect(html).toContain('Latest');
  });
});

describe('renderRange', () => {
  it('defaults to the newest page', () => {
    expect(renderRange(keys(1000), { startKey: null, endKey: null }, -1)).toEqual({ start: 1000 - P, end: 1000 });
  });

  it('holds an expanded window by its start key while new nodes arrive (no sliding)', () => {
    const anchor = { startKey: 'k700', endKey: null };
    expect(renderRange(keys(1000), anchor, -1)).toEqual({ start: 700, end: 1000 });
    expect(renderRange(keys(1010), anchor, -1)).toEqual({ start: 700, end: 1010 });
  });

  it('falls back to the newest page when the anchor is gone', () => {
    expect(renderRange(keys(500), { startKey: 'missing', endKey: null }, -1)).toEqual({ start: 500 - P, end: 500 });
  });

  it('keeps a revealed node that is already inside the window where it is', () => {
    expect(renderRange(keys(1000), { startKey: null, endKey: null }, 990)).toEqual({ start: 1000 - P, end: 1000 });
  });

  it('pages around a revealed node outside the window', () => {
    expect(renderRange(keys(1000), { startKey: null, endKey: null }, 100)).toEqual({ start: 90, end: 90 + P });
  });
});
