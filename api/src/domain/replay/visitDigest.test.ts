import { describe, expect, it } from 'vitest';
import type { ReplayMark } from '@builderforce/interaction-contract';
import { clock, DIGEST_MAX_LINES, markLine, oneLineDigest, visitDigest, type DigestRecording } from './visitDigest';
import { parseCitations, parsePatternCitations } from './summaryCitations';

const RECORDING: DigestRecording = {
  deviceClass: 'phone', browser: 'Safari', os: 'iOS', releaseKey: 'r42', durationMs: 83_000,
  entryPath: '/', exitPath: '/checkout', tags: { plan: 'pro' },
};

const MARKS: ReplayMark[] = [
  { kind: 'page', key: '/', atMs: 0 },
  { kind: 'click', key: 'button.buy', label: 'Buy\nnow "today"', atMs: 61_500 },
  { kind: 'rage', key: 'button.pay', label: 'Pay', atMs: 75_000 },
];

describe('visitDigest', () => {
  it('writes a header and one `[mm:ss #ord] kind key "label"` line per mark', () => {
    const lines = visitDigest(RECORDING, MARKS).split('\n');
    expect(lines[0]).toBe('visit: phone / Safari / iOS · release r42 · 1m 23s');
    expect(lines[1]).toBe('path: / → /checkout');
    expect(lines[2]).toBe('tags: plan=pro');
    expect(lines.slice(3)).toEqual([
      '[00:00 #0] page /',
      "[01:01 #1] click button.buy \"Buy now 'today'\"",
      '[01:15 #2] rage button.pay "Pay"',
    ]);
  });

  it('caps the digest at 300 lines, header included', () => {
    const many: ReplayMark[] = Array.from({ length: 1_000 }, (_, i) => ({ kind: 'click', key: `#b${i}`, atMs: i * 10 }));
    const lines = visitDigest(RECORDING, many).split('\n');
    expect(lines).toHaveLength(DIGEST_MAX_LINES);
    expect(lines[lines.length - 1]).toContain(`#${DIGEST_MAX_LINES - 4}]`);
  });

  it('never carries anything but the mark fields (no page text)', () => {
    const digest = visitDigest(RECORDING, [{ kind: 'page', key: '/a', atMs: 0, events: ['<p>secret</p>'] } as unknown as ReplayMark]);
    expect(digest).not.toContain('secret');
  });

  it('formats clock and one-line digests', () => {
    expect(clock(3_725_000)).toBe('62:05');
    expect(markLine({ kind: 'vital', key: 'LCP', atMs: 1_000, value: 2512.4 }, 7)).toBe('[00:01 #7] vital LCP =2512');
    expect(oneLineDigest({ ...RECORDING, pageCount: 3, counts: { rage: 2, dead: 0, errors: 1 }, converted: true }))
      .toBe('phone 1m 23s · / → /checkout · 3 pages · 2 rage, 1 errors · converted');
  });
});

describe('parseCitations', () => {
  it('keeps only sentences ending in a citation of an existing ord', () => {
    const out = parseCitations('The visitor landed on home #0. They hesitated a lot. They rage-clicked Pay (#2). Invented moment #9.', 3);
    expect(out.summary).toBe('The visitor landed on home #0. They rage-clicked Pay (#2).');
    expect(out.ords).toEqual([0, 2]);
  });

  it('drops a sentence whose citation is not at its end', () => {
    expect(parseCitations('At #1 they clicked buy and then left.', 3).summary).toBe('');
  });
});

describe('parsePatternCitations', () => {
  const A = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
  const B = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002';
  it('keeps patterns with valid recording#ord citations and strips them from the text', () => {
    const text = [
      `1. Visitors rage-click the Pay button [${A}#2, ${B}#1].`,
      '2. Something with no citation.',
      `3. Phantom moment ${A}#99.`,
    ].join('\n');
    const out = parsePatternCitations(text, new Map([[A, 3], [B, 2]]));
    expect(out).toEqual([{ text: 'Visitors rage-click the Pay button.', examples: [{ recordingId: A, ord: 2 }, { recordingId: B, ord: 1 }] }]);
  });
});
