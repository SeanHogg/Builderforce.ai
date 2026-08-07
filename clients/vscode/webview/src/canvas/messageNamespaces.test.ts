import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasImportClosure, canvasPaths, collectCanvasNamespaces } from './messageNamespaces';

/**
 * Guards the trimmed catalogs shipped in the canvas bundle.
 *
 * The namespace list is derived from source, so it cannot go stale — but the
 * derivation itself can: a refactor that renames the entry, or a namespace that
 * exists on the web in only some locales, would silently ship a canvas rendering
 * raw message keys (a missing namespace is not an error in `use-intl`). These
 * assert the derivation still finds the canvas, and that everything it finds is
 * actually translatable in all five languages.
 */

const WEBVIEW_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOCALES = ['en', 'zh', 'es', 'fr', 'de'] as const;

describe('canvas message namespaces', () => {
  it('walks a real import closure from the canvas entry', () => {
    const { entry, frontendSrc } = canvasPaths(WEBVIEW_DIR);
    expect(fs.existsSync(entry), `canvas entry moved: ${entry}`).toBe(true);

    // The canvas pulls in ~120 first-party modules. A closure that collapsed to
    // a handful would mean resolution broke and the trim silently under-ships.
    const closure = canvasImportClosure(entry, frontendSrc);
    expect(closure.length).toBeGreaterThan(80);
  });

  it('derives the namespaces the canvas translates, including lazy surfaces', () => {
    const { entry, frontendSrc } = canvasPaths(WEBVIEW_DIR);
    const namespaces = collectCanvasNamespaces(entry, frontendSrc);

    // The board's own namespaces, always reachable.
    expect(namespaces).toEqual(expect.arrayContaining(['creationCanvas', 'canvasCommands', 'common']));
    // And the dynamically-imported surfaces — the ones a static-only walk misses,
    // which would render raw keys the moment a user opened them.
    expect(namespaces).toEqual(expect.arrayContaining(['aiTraining', 'ide', 'evermindStudio']));
  });

  it('ships every derived namespace in every locale catalog', () => {
    const { entry, frontendSrc } = canvasPaths(WEBVIEW_DIR);
    const namespaces = collectCanvasNamespaces(entry, frontendSrc);

    for (const locale of LOCALES) {
      const catalog = JSON.parse(
        fs.readFileSync(path.join(frontendSrc, `i18n/messages/${locale}.json`), 'utf8'),
      ) as Record<string, unknown>;
      const missing = namespaces.filter((namespace) => catalog[namespace] === undefined);
      expect(missing, `${locale}.json is missing: ${missing.join(', ')}`).toEqual([]);
    }
  });
});
