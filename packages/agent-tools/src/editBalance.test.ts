import { describe, expect, it } from 'vitest';
import { bracketBalance, bracketDelta, changesBalance } from './editBalance.js';

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
});
