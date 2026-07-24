import { describe, it, expect } from 'vitest';
import { validateFileContentForPath, coerceFileContent } from './fileContentGuard';
import { VANILLA_DEFAULTS, MOBILE_DEFAULTS } from './vanillaDefaults';

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

  // Inverse guard: a JS/TS file that is actually a JSON object/array is another
  // file's data cross-wired in (the package.json → vite.config.js corruption
  // that crashed Vite with `Expected ";" but found ":"`).
  it("rejects package.json's JSON written into a .js file", () => {
    const pkgJson = JSON.stringify({ name: 'my-mobile-app', version: '1.0.0' }, null, 2);
    const r = validateFileContentForPath('vite.config.js', pkgJson);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/JSON data, not JS source/);
    // Same for a JSON array in a .ts file.
    expect(validateFileContentForPath('data.ts', '[1, 2, 3]').ok).toBe(false);
  });

  it('leaves a bare JSON scalar in a .js file alone (valid JS expression)', () => {
    // `"x"` / `42` / `true` parse as JSON but are legitimate JS statements.
    expect(validateFileContentForPath('flag.js', 'true').ok).toBe(true);
    expect(validateFileContentForPath('n.js', '42').ok).toBe(true);
    expect(validateFileContentForPath('s.ts', '"hello"').ok).toBe(true);
  });

  // The real scaffolds must all pass their own guard, in BOTH directions — the
  // JS configs/sources aren't flagged as JSON, and package.json stays valid JSON.
  it.each([
    ['vanilla', VANILLA_DEFAULTS],
    ['mobile', MOBILE_DEFAULTS],
  ])('accepts every %s scaffold file at its own path', (_name, template) => {
    for (const [path, content] of Object.entries(template)) {
      expect(validateFileContentForPath(path, content)).toEqual({ ok: true });
    }
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
