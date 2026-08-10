/**
 * Parity: the server-side content contract (workspaceStore.validateWorkspaceContent)
 * must agree with the frontend guard (fileContentGuard.validateFileContentForPath)
 * on every vector. The two runtimes cannot share a module (Worker vs Next — see
 * the template-parity note in projectTemplate.ts), so this test IS the shared
 * source: if one side learns a new rule and the other doesn't, this fails.
 */
import { describe, it, expect } from 'vitest';
import { validateWorkspaceContent } from './workspaceStore';
import { validateFileContentForPath } from '../../../../frontend/src/lib/fileContentGuard';

/** [path, content, shouldPass] — every rule and its false-positive guard. */
const VECTORS: Array<[string, string, boolean]> = [
  // Blank content is always allowed (file creation)
  ['package.json', '', true],
  ['index.html', '   \n', true],
  // .json must parse
  ['package.json', '{"name":"app"}', true],
  ['package.json', 'body { color: red; }', false],
  ['package.json', 'not json {', false],
  // .jsonl per-line
  ['data.jsonl', '{"a":1}\n{"b":2}', true],
  ['data.jsonl', '{"a":1}\nnope', false],
  // JS/TS must not be JSON data
  ['vite.config.js', '{\n  "name": "my-mobile-app"\n}', false],
  ['data.ts', '[1, 2, 3]', false],
  ['flag.js', 'true', true],           // bare scalar = valid JS statement
  ['n.js', '42', true],
  ['App.js', "import x from 'y';\nexport default x;", true],
  // JS/TS must not be an HTML document
  ['index.js', '<!DOCTYPE html>\n<html></html>', false],
  ['App.jsx', '<html lang="en"></html>', false],
  ['App.jsx', 'const ok = a < b;', true], // bare < is fine
  // .html must start with markup
  ['index.html', "import { defineConfig } from 'vite';", false],
  ['index.html', '{"name":"x"}', false],
  ['index.html', '<!DOCTYPE html><html></html>', true],
  ['page.htm', '<div id="root"></div>', true],
  // Unpoliced extensions pass anything
  ['styles.css', 'body { color: red; }', true],
  ['README.md', '# Title', true],
  ['noext', 'anything at all', true],
];

describe('content guard parity (api workspaceStore ≡ frontend fileContentGuard)', () => {
  it.each(VECTORS)('%s ← %j → pass=%s on BOTH sides', (path, content, shouldPass) => {
    expect(validateWorkspaceContent(path, content).ok).toBe(shouldPass);
    expect(validateFileContentForPath(path, content).ok).toBe(shouldPass);
  });
});
