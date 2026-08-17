import { describe, expect, it } from 'vitest';
import { regexMatch, htmlToText } from './workflowTextTools';

describe('regexMatch', () => {
  it('finds a single match with capture groups', () => {
    const r = regexMatch('(\\d{3})-(\\d{4})', '', 'call 555-1234 now');
    expect(r.matched).toBe(true);
    expect(r.matches).toEqual(['555-1234', '555', '1234']);
  });

  it('finds all matches with the g flag', () => {
    const r = regexMatch('\\d+', 'g', 'a1 b22 c333');
    expect(r.matched).toBe(true);
    expect(r.matches).toEqual(['1', '22', '333']);
  });

  it('reports no match without throwing', () => {
    const r = regexMatch('xyz', '', 'abc');
    expect(r).toEqual({ matched: false, matches: [], groups: null });
  });

  it('degrades to no-match on an invalid pattern instead of throwing', () => {
    expect(() => regexMatch('(unclosed', '', 'abc')).not.toThrow();
    expect(regexMatch('(unclosed', '', 'abc').matched).toBe(false);
  });

  it('ignores an invalid flags string (falls back to no flags) rather than throwing', () => {
    const r = regexMatch('a', 'not-a-flag!', 'abc');
    expect(r.matched).toBe(true);
    expect(r.matches).toEqual(['a']);
  });

  it('exposes named capture groups', () => {
    const r = regexMatch('(?<year>\\d{4})-(?<month>\\d{2})', '', '2026-08-16');
    expect(r.groups).toEqual({ year: '2026', month: '08' });
  });

  it('empty pattern is a no-match, not a match-everything', () => {
    expect(regexMatch('', '', 'abc').matched).toBe(false);
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes common entities', () => {
    expect(htmlToText('<p>Hello &amp; welcome</p>')).toBe('Hello & welcome');
  });

  it('drops script and style content entirely', () => {
    const out = htmlToText('<div>keep</div><script>evil()</script><style>.x{color:red}</style>');
    expect(out).toBe('keep');
  });

  it('converts block boundaries to newlines', () => {
    const out = htmlToText('<p>one</p><p>two</p>');
    expect(out).toBe('one\ntwo');
  });

  it('handles empty input without throwing', () => {
    expect(htmlToText('')).toBe('');
  });
});
