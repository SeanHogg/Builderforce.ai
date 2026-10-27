import { describe, expect, it } from 'vitest';
import {
  CLOUD_MENTION_BUDGET,
  LOCAL_MENTION_BUDGET,
  MIN_KEEP_CHARS,
  inlineMentions,
  mentionBudget,
} from './index.js';
// The fit and the render are the module's internals, tested directly (the package exports
// only their composition, `inlineMentions`).
import { fitMentions, renderMentions } from './mentions.js';

describe('mentionBudget', () => {
  it('gives the cloud its fixed row', () => {
    expect(mentionBudget('cloud')).toEqual(CLOUD_MENTION_BUDGET);
    // A window never shrinks or grows the cloud row.
    expect(mentionBudget('cloud', { contextWindowTokens: 8_000 })).toEqual(CLOUD_MENTION_BUDGET);
  });

  it('falls back to the small local row when the local window is unknown', () => {
    expect(mentionBudget('local')).toEqual(LOCAL_MENTION_BUDGET);
    expect(mentionBudget('local', { contextWindowTokens: 0 })).toEqual(LOCAL_MENTION_BUDGET);
    expect(mentionBudget('local', { contextWindowTokens: Number.NaN })).toEqual(LOCAL_MENTION_BUDGET);
  });

  it('sizes the local row from a known window, clamped to the cloud row and a floor', () => {
    const small = mentionBudget('local', { contextWindowTokens: 8_000 });
    expect(small.totalChars).toBe(9_600);
    expect(small.perFileChars).toBe(6_400);
    const big = mentionBudget('local', { contextWindowTokens: 1_000_000 });
    expect(big).toEqual(CLOUD_MENTION_BUDGET);
    const tiny = mentionBudget('local', { contextWindowTokens: 100 });
    expect(tiny.totalChars).toBe(MIN_KEEP_CHARS);
    expect(tiny.perFileChars).toBe(MIN_KEEP_CHARS);
  });
});

describe('fitMentions', () => {
  it('keeps short mentions whole', () => {
    const [m] = fitMentions([{ name: 'a.md', text: 'hello' }], { perFileChars: 100, totalChars: 100 });
    expect(m).toMatchObject({ text: 'hello', keptChars: 5, originalChars: 5, truncated: false });
  });

  it('cuts one file to the per-file cap, at a line end when one is near', () => {
    const text = `${'x'.repeat(90)}\n${'y'.repeat(50)}`;
    const [m] = fitMentions([{ name: 'a.txt', text }], { perFileChars: 100, totalChars: 1_000 });
    expect(m!.truncated).toBe(true);
    expect(m!.text).toBe('x'.repeat(90));
    expect(m!.originalChars).toBe(141);
  });

  it('spends the turn total in order and marks the rest omitted', () => {
    const fitted = fitMentions(
      [
        { name: 'one', text: 'a'.repeat(60) },
        { name: 'two', text: 'b'.repeat(60) },
        { name: 'three', text: 'c'.repeat(60) },
      ],
      { perFileChars: 60, totalChars: 100 },
    );
    expect(fitted.map((m) => m.keptChars)).toEqual([60, 40, 0]);
    expect(fitted.map((m) => m.truncated)).toEqual([false, true, true]);
  });
});

describe('renderMentions', () => {
  it('fences each file under its name, with a marker naming what was cut', () => {
    const out = inlineMentions(
      [
        { name: 'docs/a.md', text: 'alpha', note: 'compressed' },
        { name: 'src/b.ts', text: 'b'.repeat(50) },
        { name: 'c.log', text: 'never shown' },
      ],
      { perFileChars: 20, totalChars: 25 },
    );
    expect(out).toContain('Attached file: docs/a.md (compressed)\n```\nalpha\n```');
    expect(out).toContain('Attached file: src/b.ts');
    expect(out).toContain('[src/b.ts truncated — showing the first 20 of 50 chars');
    expect(out).toContain('[c.log omitted');
    expect(out).not.toContain('never shown');
  });

  it('uses a fence longer than any backtick run in the text', () => {
    const out = renderMentions(fitMentions([{ name: 'r.md', text: 'see ```ts\ncode\n```' }], CLOUD_MENTION_BUDGET));
    expect(out).toContain('````\nsee ```ts');
    expect(out.trimEnd().endsWith('````')).toBe(true);
  });

  it('renders nothing for no mentions', () => {
    expect(renderMentions([])).toBe('');
  });
});
