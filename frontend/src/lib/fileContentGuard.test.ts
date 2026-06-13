import { describe, it, expect } from 'vitest';
import { validateFileContentForPath } from './fileContentGuard';

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
});
