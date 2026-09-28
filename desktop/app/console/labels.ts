/**
 * The Evermind console's translated labels, derived at BUILD time from the one place
 * they are already written and translated: the VS Code extension's label bundle
 * (`buildEvermindLabels` in `clients/vscode/src/evermindView.ts`, English literals
 * passed to `vscode.l10n.t`) and its five `l10n/bundle.l10n.*.json` catalogs, which map
 * each English literal to its translation. Never a committed copy — a string reworded
 * or translated for the extension reaches Synapse on its next build.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Synapse's locales → the extension's catalog files. */
const CATALOGS: Record<string, string> = {
  en: 'bundle.l10n.json',
  zh: 'bundle.l10n.zh-cn.json',
  es: 'bundle.l10n.es.json',
  fr: 'bundle.l10n.fr.json',
  de: 'bundle.l10n.de.json',
};

/** `"ev.key": t("English")` pairs, in source order. */
export function readEvermindKeys(source: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const re = /"(ev\.\w+)":\s*t\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  for (const m of source.matchAll(re)) pairs.push([m[1], JSON.parse(`"${m[2]}"`) as string]);
  return pairs;
}

/** `{ locale: { 'ev.key': text } }` — English where a catalog lacks the string. */
export function buildEvermindLabelBundles(vscodeDir: string): { bundles: Record<string, Record<string, string>>; files: string[] } {
  const viewFile = path.join(vscodeDir, 'src/evermindView.ts');
  const keys = readEvermindKeys(fs.readFileSync(viewFile, 'utf8'));
  if (keys.length === 0) throw new Error(`no ev.* labels found in ${viewFile}`);
  const files = [viewFile];
  const bundles: Record<string, Record<string, string>> = {};
  for (const [locale, name] of Object.entries(CATALOGS)) {
    const file = path.join(vscodeDir, 'l10n', name);
    files.push(file);
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string | { message?: string }>;
    bundles[locale] = Object.fromEntries(keys.map(([key, english]) => {
      const hit = catalog[english];
      const text = typeof hit === 'string' ? hit : hit?.message;
      return [key, text || english];
    }));
  }
  return { bundles, files };
}
