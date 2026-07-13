import { describe, it, expect } from 'vitest';
import { validateFileContentForPath, coerceFileContent } from './fileContentGuard';

describe('validateFileContentForPath', () => {
  it('allows empty/whitespace content for any path (blank file)', () => {
    expect(validateFileContentForPath('package.json', '').ok).toBe(true);
    expect(validateFileContentForPath('package.json', '   \n').ok).toBe(true);
  });

  it('rejects malformed JSON written to a .json file (the package.json/CSS bug)', () => {
    const r = validateFileContentForPath('package.json', 'body { color: red; }');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/valid JSON/);
  });

  it('accepts well-formed JSON', () => {
    expect(validateFileContentForPath('tsconfig.json', '{"compilerOptions":{}}').ok).toBe(true);
  });

  it('validates .jsonl per-line and rejects a bad line', () => {
    expect(validateFileContentForPath('data.jsonl', '{"a":1}\n{"b":2}\n').ok).toBe(true);
    const r = validateFileContentForPath('data.jsonl', '{"a":1}\nnot json\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/line 2/);
  });

  it('does not police non-structural extensions (css/js/ts/md)', () => {
    expect(validateFileContentForPath('styles.css', 'body { color: red; }').ok).toBe(true);
    expect(validateFileContentForPath('App.jsx', 'export default () => null;').ok).toBe(true);
    expect(validateFileContentForPath('README.md', '# Title').ok).toBe(true);
    expect(validateFileContentForPath('noext', 'anything').ok).toBe(true);
  });

  // The model emits package.json content as an object, not a string — the guard
  // must not crash on `.trim()` of a non-string (the `t.trim is not a function`
  // bug that broke create_file).
  it('does not throw when given a non-string body (object content)', () => {
    const obj = { name: 'rumble-dating', version: '1.0.0' } as unknown as string;
    expect(() => validateFileContentForPath('package.json', obj)).not.toThrow();
    // Coerced to valid JSON, so it passes the .json structural check.
    expect(validateFileContentForPath('package.json', obj).ok).toBe(true);
  });
});

describe('coerceFileContent', () => {
  it('passes strings through unchanged', () => {
    expect(coerceFileContent('hello')).toBe('hello');
    expect(coerceFileContent('')).toBe('');
  });

  it('serializes an object body to pretty JSON (the package.json-as-object case)', () => {
    const pkg = { name: 'app', version: '1.0.0' };
    const out = coerceFileContent(pkg);
    expect(JSON.parse(out)).toEqual(pkg);
    expect(out).toContain('\n'); // pretty-printed
  });

  it('treats null/undefined as a blank file', () => {
    expect(coerceFileContent(null)).toBe('');
    expect(coerceFileContent(undefined)).toBe('');
  });

  it('stringifies other scalars', () => {
    expect(coerceFileContent(42)).toBe('42');
    expect(coerceFileContent(true)).toBe('true');
  });
});
