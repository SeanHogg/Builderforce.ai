import { describe, expect, it } from 'vitest';
import { tomlString, tomlStringArrays, tomlTable, tomlTables } from './minimalToml';

describe('minimalToml', () => {
  it('reads tables, quoted and dotted keys, and the first [[array]] table', () => {
    const tables = tomlTables([
      'name = "top"',
      '[package]',
      'name = "shop" # the crate',
      '[dependencies]',
      '"flask-cors" = "*"',
      'axum.workspace = true',
      "[target.'cfg(unix)'.dependencies]",
      'nix = "0.29"',
      '[[bin]]',
      'name = "first"',
      '[[bin]]',
      'name = "second"',
    ].join('\n'));
    expect(tomlString(tables.get('')?.get('name'))).toBe('top');
    expect(tomlString(tables.get('package')?.get('name'))).toBe('shop');
    expect([...tables.get('dependencies')!.keys()]).toEqual(['flask-cors', 'axum.workspace']);
    expect(tables.get('target.cfg(unix).dependencies')?.has('nix')).toBe(true);
    expect(tomlString(tables.get('bin')?.get('name'))).toBe('first');
    expect(tomlTable('x = 1', 'missing').size).toBe(0);
  });

  it('reads string arrays across lines, keeping # inside strings, scoped to a table', () => {
    const text = '[project]\ndependencies = [\n  "a#b", # comment "not-this"\n  \'c\',\n]\n[workspace]\nmembers = ["api", "crates/*"]\n';
    expect(tomlStringArrays(text, 'dependencies')).toEqual(['a#b', 'c']);
    expect(tomlStringArrays(text, 'members', 'workspace')).toEqual(['api', 'crates/*']);
    expect(tomlStringArrays(text, 'members', 'project')).toEqual([]);
  });

  it('regression: a CRLF file reads a multi-line array 20+ lines down exactly (pyproject and Cargo)', () => {
    const filler = Array.from({ length: 24 }, (_, i) => `# line ${i} v${i}`);
    const pyproject = [...filler, '[project]', 'name = "shop"', 'dependencies = [', '  "fastapi>=0.110",', '  "uvicorn[standard]",', ']', ''].join('\r\n');
    expect(tomlStringArrays(pyproject, 'dependencies')).toEqual(['fastapi>=0.110', 'uvicorn[standard]']);
    const cargo = [...filler, '[workspace]', 'members = [', '  "api",', '  "crates/*",', ']', ''].join('\r\n');
    expect(tomlStringArrays(cargo, 'members', 'workspace')).toEqual(['api', 'crates/*']);
  });

  it('honours escaped quotes in basic strings; literal strings take none', () => {
    expect(tomlStringArrays('a = ["say \\"hi\\"", \'c:\\\\x\', "back\\\\slash"]', 'a')).toEqual(['say "hi"', 'c:\\\\x', 'back\\slash']);
    expect(tomlString('"a \\"b\\"" # c')).toBe('a "b"');
    expect(tomlString("'c:\\x'")).toBe('c:\\x');
  });

  it('an unterminated string stops at the end of its line', () => {
    expect(tomlStringArrays('a = [\n  "open,\n  "ok",\n]', 'a')).toEqual(['ok']);
    expect(tomlString('"open')).toBeUndefined();
    // A `\` at the end of a line escapes nothing: the string still ends there.
    expect(tomlStringArrays('a = [\n  "open\\\n  "ok",\n]', 'a')).toEqual(['ok']);
    expect(tomlStringArrays('a = [\r\n  "open\\\r\n  "ok",\r\n]', 'a')).toEqual(['ok']);
  });

  it('a value that is not a quoted string has no string', () => {
    expect(tomlString('true')).toBeUndefined();
    expect(tomlString(undefined)).toBeUndefined();
    expect(tomlString("'single'")).toBe('single');
  });
});
