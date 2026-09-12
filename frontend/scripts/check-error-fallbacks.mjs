#!/usr/bin/env node
/**
 * No hardcoded-English error fallbacks on a surface a person reads.
 *
 * `faultMessage(e, 'Create failed')` and `e instanceof Error ? e.message : 'Save
 * failed'` were written at 184 sites, each with its own English sentence — so a
 * rejection that carried no message of its own reached a German, French, Spanish
 * or Chinese reader in English. The fallback is only ever shown when the error says
 * nothing, so it never needed to be specific; it needed to be translated.
 *
 * The two doors:
 *   - a surface a PERSON reads → `useErrorMessage()` / `useErrorText()` from
 *     `@/i18n/useErrorMessage` (one fallback, `common.actionFailed`), or
 *     `faultMessage(e, t('someKey'))` where a surface has a more specific message;
 *   - a tool result the MODEL reads → `toolErrorMessage(e, 'English fallback')`
 *     from `@/lib/toolErrorMessage`, which names the English as deliberate.
 *
 * Flagged, anywhere under `src/` outside tests:
 *   1. `faultMessage(…, '<literal>')` / `faultText(…, '<literal>')` — a string or
 *      template literal as the fallback argument (an empty `''` is not prose);
 *   2. `… instanceof Error ? … : '<literal>'` — a literal on the else arm.
 *
 * Flagged in a COMPONENT FILE (a `.tsx`, or a `.ts` that imports from `react` —
 * a hook module):
 *   3. a BARE `faultMessage(e)` / `faultText(e)` — one argument, no fallback.
 *      It has no English literal of its own, but it still shows English: a
 *      request that never reached the server throws an `ApiTransportError`
 *      whose message is the engineer-facing sentence the Quality feed files
 *      (English BY DESIGN), and only `useErrorMessage()` reads that as the
 *      localized `globalError.transport.<reason>`. ~200 such sites were migrated
 *      on 2026-09-12. A plain lib function has no hook to call — it takes the
 *      message function from its caller, or returns a code the caller translates.
 *
 * ZERO baseline, not a ratchet: every site was migrated on 2026-09-12.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');

/** `faultMessage(` / `faultText(`, a first argument (one level of nested parens), then a
 *  non-empty string or template literal as the second. */
const FAULT_LITERAL = /\bfault(?:Message|Text)\(\s*[^,()]*(?:\([^()]*\)[^,()]*)*,\s*(['"`])(?!\1)/g;
/** An `instanceof Error` ternary whose else arm is a non-empty literal. */
const TERNARY_LITERAL = /\binstanceof\s+Error\s*\?[^:;]*?:\s*(['"`])(?!\1)/g;
/** `faultMessage(` / `faultText(` with ONE argument (one level of nested parens) — no fallback. */
const FAULT_BARE = /\bfault(?:Message|Text)\(\s*[^,()]*(?:\([^()]*\)[^,()]*)*\)/g;

/** A file that renders or is a hook: `.tsx`, or a `.ts` importing from `react`. */
const isComponentFile = (rel, code) => /\.tsx$/.test(rel) || /\bfrom\s+['"]react['"]/.test(code);

/**
 * Component files where a bare call is genuinely not a surface a person reads —
 * each entry `'path/under/src.tsx': 'reason'`. Empty: no such site exists.
 */
const BARE_ALLOWED = new Map([]);

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Blank out comments, keeping every newline so line numbers survive. A `//` only
 *  opens a comment at line start or after whitespace — `'https://…'` is a string. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, (_, lead) => lead);
}

const sites = [];
for (const file of collect(srcDir)) {
  const rel = relative(srcDir, file).split('\\').join('/');
  if (/\.test\.tsx?$/.test(rel)) continue;
  const code = stripComments(readFileSync(file, 'utf8'));
  const patterns = [FAULT_LITERAL, TERNARY_LITERAL];
  if (isComponentFile(rel, code) && !BARE_ALLOWED.has(rel)) patterns.push(FAULT_BARE);
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of code.matchAll(pattern)) {
      const line = code.slice(0, match.index).split('\n').length;
      sites.push(`${rel}:${line}`);
    }
  }
}

if (sites.length > 0) {
  console.error(`❌  ${sites.length} hardcoded-English error fallback${sites.length === 1 ? '' : 's'} (a literal fallback, or a bare faultMessage(e)/faultText(e) in a component file) — use useErrorMessage()/useErrorText() (@/i18n/useErrorMessage) on a surface a person reads, or toolErrorMessage() (@/lib/toolErrorMessage) in a tool result the model reads:\n`);
  for (const site of [...new Set(sites)].sort()) console.error(`   ${site}`);
  process.exit(1);
}
console.log('✅  No hardcoded-English error fallbacks.');
