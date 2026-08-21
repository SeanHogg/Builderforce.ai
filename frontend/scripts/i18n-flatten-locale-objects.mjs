#!/usr/bin/env node
/**
 * Split the per-locale OBJECTS that were merged into every catalog as one value.
 *
 * A patch pass wrote thirty messages in the shape
 *
 *   "unstaffed": { "en": "{count} unstaffed", "zh": "…", "es": "…", … }
 *
 * into all five catalogs, instead of writing the `en` string into `en.json`, the
 * `zh` string into `zh.json`, and so on. Every one of them is therefore an OBJECT
 * where next-intl expects a message, and next-intl renders the dotted path when
 * asked to format one — which is why `board.audit.unstaffed` and nine of its
 * neighbours were sitting in the product as raw keys, in all five languages at
 * once. The translations were never missing; they were in the wrong shape.
 *
 * This is a one-shot repair, kept because it is the record of what was wrong.
 * `messages.test.ts` now fails if the shape ever comes back, so it should not
 * need a second run.
 *
 *   node scripts/i18n-flatten-locale-objects.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MESSAGES = resolve(here, '../src/i18n/messages');
const LOCALES = ['en', 'zh', 'es', 'fr', 'de'];
const LOCALE_SET = new Set(LOCALES);

/** A node is a smuggled per-locale bundle when every key it has is a locale code
 *  and every value is a string. A real namespace never looks like that. */
export function isLocaleBundle(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const keys = Object.keys(node);
  return keys.length > 0 && keys.every((key) => LOCALE_SET.has(key)) && keys.every((key) => typeof node[key] === 'string');
}

function flatten(node, locale, found) {
  for (const [key, value] of Object.entries(node)) {
    if (isLocaleBundle(value)) {
      // Fall back to `en` for a bundle that never carried this locale, so a
      // partial bundle degrades to a readable string rather than to `undefined`.
      node[key] = value[locale] ?? value.en ?? '';
      found.push(key);
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, locale, found);
  }
}

for (const locale of LOCALES) {
  const file = resolve(MESSAGES, `${locale}.json`);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const found = [];
  flatten(json, locale, found);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  console.log(`${locale}: flattened ${found.length}`);
}
