#!/usr/bin/env node
/**
 * No browser-native dialogs.
 *
 * `window.confirm`, `window.prompt` and `window.alert` cannot be styled, cannot
 * be translated past their one string, block the whole page, and inside an
 * embedded webview may not open at all — so a destructive action behind one is
 * either dismissed by reflex or never confirmed. The app has its own doors:
 * `useConfirm()` (the one modal, reserved for destructive approvals),
 * `useToast()` for a result, and `InlineNameForm` where a prompt asked for a
 * name. The rule was stated in four comments and enforced nowhere; nine call
 * sites had slipped past it. This is a ZERO baseline, not a ratchet: the last
 * site was migrated on 2026-09-06 and none may return.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');

/** Fixture text that spells `alert(` inside a string, never a call. */
const ALLOWED = new Set(['lib/canvasTestData.ts']);
/** `window.x(` in any form, plus a bare `alert(` that is not a member access.
 *  A bare `confirm(` is the hook's replacement and a bare `prompt(` is the word
 *  every LLM module uses for its own function, so neither is flagged — the
 *  native forms of both are always written `window.` here. */
const NATIVE = /\bwindow\.(confirm|prompt|alert)\s*\(|(?<![\w.$])alert\s*\(/;

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const sites = [];
for (const file of collect(srcDir)) {
  const rel = relative(srcDir, file).split('\\').join('/');
  if (ALLOWED.has(rel) || /\.test\.tsx?$/.test(rel)) continue;
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
    const code = line.replace(/\/\/.*$/, '');
    if (NATIVE.test(code)) sites.push(`${rel}:${i + 1}`);
  });
}

if (sites.length > 0) {
  console.error(`❌  Browser-native dialog${sites.length === 1 ? '' : 's'} found — use useConfirm(), useToast() or InlineNameForm instead:\n`);
  for (const site of sites) console.error(`   ${site}`);
  process.exit(1);
}
console.log('✅  No browser-native dialogs.');
