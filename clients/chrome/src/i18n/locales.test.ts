/**
 * Every message key the source reads resolves in EVERY shipped locale — not just
 * catalog-to-catalog parity, which cannot see a key missing from all five. The
 * manifest's `__MSG_…__` names and every registry of keys (tool labels) are held to
 * the same rule, and so is every `t('…')` call in the source.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOCAL_MODEL_LABEL_FIELDS } from '@seanhogg/builderforce-brain-ui';
import { rovrLocalModelKey } from '../sidepanel/labels/localModelLabels';
import { TOOL_LABEL_KEYS } from '../sidepanel/toolLabels';
import { MESSAGE_KEYS } from './keys';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const LOCALES = ['en', 'de', 'es', 'fr', 'zh_CN'];

const catalog = (locale: string): Record<string, { message: string }> =>
  JSON.parse(fs.readFileSync(path.join(root, '_locales', locale, 'messages.json'), 'utf8'));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('Rovr locale catalogs', () => {
  it.each(LOCALES)('%s resolves every key the source reads, with a non-empty message', (locale) => {
    const messages = catalog(locale);
    for (const key of MESSAGE_KEYS) {
      expect(messages[key]?.message, `${locale}: ${key}`).toBeTruthy();
    }
  });

  it.each(LOCALES)('%s carries no key the source does not read', (locale) => {
    expect(Object.keys(catalog(locale)).sort()).toEqual([...MESSAGE_KEYS].sort());
  });

  it.each(LOCALES)('%s keeps every positional substitution of the English message', (locale) => {
    const en = catalog('en');
    const messages = catalog(locale);
    for (const key of MESSAGE_KEYS) {
      const want = (en[key]!.message.match(/\$\d/g) ?? []).sort();
      expect((messages[key]!.message.match(/\$\d/g) ?? []).sort(), `${locale}: ${key}`).toEqual(want);
    }
  });

  it('every t() call in the source names a listed key', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(path.join(root, 'src'))) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(20);
    for (const key of used) expect(MESSAGE_KEYS as readonly string[], key).toContain(key);
  });

  it('every tool label key resolves', () => {
    for (const key of Object.values(TOOL_LABEL_KEYS)) expect(MESSAGE_KEYS).toContain(key);
    expect(MESSAGE_KEYS).toContain('toolOther');
  });

  it('every on-device list label key resolves', () => {
    for (const field of LOCAL_MODEL_LABEL_FIELDS) expect(MESSAGE_KEYS).toContain(rovrLocalModelKey(field));
  });

  it("the manifest's __MSG_ names resolve in every locale, and the store limits hold", () => {
    const manifest = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
    const names = [...manifest.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const locale of LOCALES) {
      const messages = catalog(locale);
      for (const name of names) expect(messages[name]?.message, `${locale}: ${name}`).toBeTruthy();
      expect([...messages.extName!.message].length).toBeLessThanOrEqual(75);
      expect([...messages.extDescription!.message].length).toBeLessThanOrEqual(132);
    }
  });
});
