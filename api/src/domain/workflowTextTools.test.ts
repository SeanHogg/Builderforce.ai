import { describe, expect, it } from 'vitest';
import {
  regexMatch, htmlToText, htmlTable, htmlElements, matchElements,
  matchPatternAdvanced, replaceText, chunkText, convertEncoding,
} from './workflowTextTools';

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

describe('htmlTable', () => {
  it('parses rows of th/td cell text from the first table', () => {
    const html = '<table><tr><th>Name</th><th>Age</th></tr><tr><td>Ann</td><td>30</td></tr></table>';
    expect(htmlTable(html)).toEqual([['Name', 'Age'], ['Ann', '30']]);
  });

  it('returns an empty array when there is no table', () => {
    expect(htmlTable('<div>no table here</div>')).toEqual([]);
  });
});

describe('htmlElements', () => {
  it('extracts every matching tag with its text and attributes', () => {
    const html = '<a href="/a">First</a><p>skip</p><a href="/b" class="x">Second</a>';
    expect(htmlElements(html, 'a')).toEqual([
      { text: 'First', attrs: { href: '/a' } },
      { text: 'Second', attrs: { href: '/b', class: 'x' } },
    ]);
  });

  it('returns an empty array for an unsanitizable tag name', () => {
    expect(htmlElements('<a>x</a>', '<script>')).toEqual([]);
  });
});

describe('matchElements', () => {
  it('filters elements to those whose text matches the pattern', () => {
    const html = '<li>apple</li><li>banana</li><li>apricot</li>';
    const matched = matchElements(html, 'li', '^ap');
    expect(matched.map((e) => e.text)).toEqual(['apple', 'apricot']);
  });

  it('returns every element when the pattern is empty', () => {
    const html = '<li>a</li><li>b</li>';
    expect(matchElements(html, 'li', '')).toHaveLength(2);
  });
});

describe('matchPatternAdvanced', () => {
  it('returns every match with its named groups', () => {
    const out = matchPatternAdvanced('(?<y>\\d{4})-(?<m>\\d{2})', '', '2026-01 then 2026-08');
    expect(out).toEqual([
      { match: '2026-01', groups: { y: '2026', m: '01' }, index: 0 },
      { match: '2026-08', groups: { y: '2026', m: '08' }, index: 13 },
    ]);
  });

  it('degrades to no matches on an invalid pattern', () => {
    expect(matchPatternAdvanced('(unclosed', '', 'abc')).toEqual([]);
  });
});

describe('replaceText', () => {
  it('replaces every literal occurrence', () => {
    expect(replaceText('a-b-c', '-', '_', '', true)).toBe('a_b_c');
  });

  it('replaces via regex with backreferences', () => {
    expect(replaceText('2026-08-16', '(\\d+)-(\\d+)-(\\d+)', '$3/$2/$1', '', false)).toBe('16/08/2026');
  });

  it('returns the input unchanged for an empty literal pattern', () => {
    expect(replaceText('abc', '', 'x', '', true)).toBe('abc');
  });
});

describe('chunkText', () => {
  it('splits into fixed-size chunks', () => {
    expect(chunkText('abcdefghij', 4, 0)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('overlaps chunks when overlap is set', () => {
    expect(chunkText('abcdefgh', 4, 2)).toEqual(['abcd', 'cdef', 'efgh']);
  });

  it('returns an empty array for empty input', () => {
    expect(chunkText('', 10, 0)).toEqual([]);
  });
});

describe('convertEncoding', () => {
  it('round-trips base64 including non-ASCII', () => {
    const encoded = convertEncoding('base64-encode', 'héllo');
    expect(convertEncoding('base64-decode', encoded)).toBe('héllo');
  });

  it('round-trips URL encoding', () => {
    expect(convertEncoding('url-decode', convertEncoding('url-encode', 'a b&c'))).toBe('a b&c');
  });

  it('round-trips hex encoding', () => {
    expect(convertEncoding('hex-decode', convertEncoding('hex-encode', 'abc'))).toBe('abc');
  });

  it('degrades to empty string on malformed decode input rather than throwing', () => {
    expect(convertEncoding('base64-decode', 'not valid base64!!!')).toBe('');
  });
});
