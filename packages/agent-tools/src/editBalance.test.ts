import { describe, expect, it } from 'vitest';
import { bracketBalance, bracketDelta, changesBalance, describeBracketDelta } from './editBalance.js';

describe('bracketDelta', () => {
  it('reports zeros for a balanced replacement', () => {
    expect(bracketDelta('foo(a, [b])', 'bar({ a }, [b, c])', 'ts')).toEqual({ curly: 0, paren: 0, square: 0 });
  });

  it('counts after minus before, per kind', () => {
    expect(bracketDelta('call(a)', 'call(a', '.ts')).toEqual({ curly: 0, paren: 1, square: 0 });
    expect(bracketDelta('call(a)', 'a)', '.ts')).toEqual({ curly: 0, paren: -1, square: 0 });
    expect(bracketDelta('', '{ [', 'src/x.tsx')).toEqual({ curly: 1, paren: 0, square: 1 });
  });

  it('ignores brackets inside quoted strings', () => {
    expect(bracketDelta('a', `const s = '{('; const t = "]}";`, 'js')).toEqual({ curly: 0, paren: 0, square: 0 });
  });

  it('honours escapes inside strings', () => {
    expect(bracketDelta('', `const s = 'it\\'s {'; f(`, 'ts')).toEqual({ curly: 0, paren: 1, square: 0 });
  });

  it('ignores line and block comments', () => {
    expect(bracketDelta('', 'x // {[(\n/* }]) */ y', 'mjs')).toEqual({ curly: 0, paren: 0, square: 0 });
  });

  it('skips template text but counts code inside an interpolation, its braces balancing themselves', () => {
    expect(bracketBalance('const s = `{ ${a ? { b } : c} ( ${fn(x)} [`;')).toEqual({ curly: 0, paren: 0, square: 0 });
    expect(bracketBalance('`${ f( }`')).toEqual({ curly: 0, paren: 1, square: 0 });
    expect(bracketBalance('`outer ${`inner ${x}`} {`')).toEqual({ curly: 0, paren: 0, square: 0 });
  });

  it('lexes JSON', () => {
    expect(bracketDelta('{"a": 1}', '{"a": "}", "b": [1, 2]', 'json')).toEqual({ curly: 1, paren: 0, square: 0 });
  });

  it('reports zeros for an extension it does not lex', () => {
    expect(bracketDelta('', '{{{', 'py')).toEqual({ curly: 0, paren: 0, square: 0 });
    expect(bracketDelta('', '{{{', 'README.md')).toEqual({ curly: 0, paren: 0, square: 0 });
  });

  it('changesBalance is true only for a non-zero delta', () => {
    expect(changesBalance({ curly: 0, paren: 0, square: 0 })).toBe(false);
    expect(changesBalance({ curly: 0, paren: 0, square: -1 })).toBe(true);
  });

  it('regression: chat #70776 labels.ts edit closes SURFACE_DEFAULTS early', () => {
    const oldString = [
      'export const SURFACE_DEFAULTS = {',
      '  ...CORE_DEFAULTS,',
      '  ...RESOLVE_DEFAULTS,',
    ].join('\n');
    const newString = [
      oldString,
      '  ...FOUR_PLUS_ONE_DEFAULTS,',
      '  ...STYLE_DEFAULTS,',
      '  ...FEATURES_DEFAULTS,',
      '};',
    ].join('\n');
    expect(bracketDelta(oldString, newString, 'labels.ts')).toEqual({ curly: -1, paren: 0, square: 0 });
  });

  const zero = { curly: 0, paren: 0, square: 0 };

  it('regression: a regex literal holding a quote does not swallow the rest of the line', () => {
    expect(bracketBalance(`s.replace(/["']/g, '')`)).toEqual(zero);
    expect(bracketDelta('a', `s.replace(/["']/g, '')`, 'ts')).toEqual(zero);
  });

  it('regression: a regex literal holding `//` is not a comment', () => {
    expect(bracketBalance('/https?:\\/\\//')).toEqual(zero);
    expect(bracketBalance('const ok = /https?:\\/\\//.test(url) && f(x);')).toEqual(zero);
  });

  it('still reads `/` after a value as division', () => {
    expect(bracketBalance('const r = (a) / 2 / (b);')).toEqual(zero);
    expect(bracketBalance('x = total / count; f(')).toEqual({ curly: 0, paren: 1, square: 0 });
  });

  it('regression: an apostrophe in JSX text is not a string', () => {
    expect(bracketBalance(`<p>Don't</p>{xs.map((x) => (`, { jsx: true })).toEqual({ curly: 1, paren: 2, square: 0 });
    expect(bracketDelta(`<p>Dont</p>{xs.map((x) => (`, `<p>Don't</p>{xs.map((x) => (`, 'src/List.tsx')).toEqual(zero);
  });

  it('regression: brackets in JSX text do not count', () => {
    expect(bracketDelta('<p>a b</p>', '<p>a (b</p>', 'tsx')).toEqual(zero);
    expect(bracketDelta('', 'return (\n  <div title="x (">\n    a (b [c\n    <span>{f(x)}</span>\n  </div>\n);', 'jsx')).toEqual(zero);
  });

  it('counts an unclosed container inside JSX', () => {
    expect(bracketDelta('<p>{a}</p>', '<p>{f(a}</p>', 'tsx')).toEqual({ curly: 0, paren: 1, square: 0 });
  });

  it('keeps tsx type parameters as code', () => {
    expect(bracketBalance('const id = <T,>(x: T) => x; f(', { jsx: true })).toEqual({ curly: 0, paren: 1, square: 0 });
    expect(bracketBalance('const id = <T extends U>(x: T) => [x', { jsx: true })).toEqual({ curly: 0, paren: 0, square: 1 });
  });

  it('describeBracketDelta renders only the kinds that moved, in either style', () => {
    expect(describeBracketDelta({ curly: -1, paren: 1, square: 0 })).toBe('curly -1 · paren +1');
    expect(describeBracketDelta({ curly: -1, paren: 1, square: 0 }, 'glyph')).toBe('`{}` -1, `()` +1');
  });
});
