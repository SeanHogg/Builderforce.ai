#!/usr/bin/env node
/**
 * Generate `src/app/agents/brandPaths.ts` from the installed `simple-icons`.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `simple-icons` ships ONE module. `index.js` and `index.mjs` are each 4.98 MiB of
 * every brand icon it knows (~3,300 of them), and v16 removed the per-icon entry points
 * that would let you take three. The integrations page imported 31 icons from that
 * barrel and used exactly one field of each — `icon.path`, a short SVG path string.
 *
 * On the CLIENT that is survivable: the package sets `sideEffects: false`, so webpack
 * tree-shakes it. On the SERVER it is not. The page is a server component, Next resolves
 * the CommonJS `index.js` for it, and CJS cannot be tree-shaken — so all 4.98 MiB landed
 * in a shared edge chunk. That chunk measured 6.71 MiB and was the single largest thing
 * in a Worker bundle that had gone over Cloudflare's 10 MiB ceiling and could not deploy.
 *
 * ── WHY GENERATED AND NOT HAND-COPIED ────────────────────────────────────────
 * Vendoring a subset is the right shape — 31 constants, about 10 KB, no runtime
 * dependency — but a hand-copied blob has no provenance and goes stale silently. This
 * script IS the provenance: the icon list below is the input, the package is the source,
 * and re-running it after a `simple-icons` bump reproduces the file exactly.
 *
 * Run: `npm run gen:brand-paths` (after adding a slug to ICONS below).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as simpleIcons from 'simple-icons';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const outFile = resolve(here, '../src/app/agents/brandPaths.ts');

/** The icons the integrations page renders. Add here, then re-run. */
const ICONS = [
  'siWhatsapp', 'siTelegram', 'siDiscord', 'siSignal', 'siApple', 'siMatrix',
  'siNextcloud', 'siZalo', 'siAnthropic', 'siGoogle', 'siOllama', 'siMistralai',
  'siPerplexity', 'siHuggingface', 'siNotion', 'siObsidian', 'siTrello', 'siGithub',
  'siSpotify', 'siSonos', 'siShazam', 'siPhilipshue', 'siHomeassistant',
  'siGooglechrome', 'siGmail', 'si1password', 'siX', 'siVercel',
  'siLinux', 'siAndroid', 'siMacos', 'siIos',
];

const missing = ICONS.filter((name) => !simpleIcons[name]?.path);
if (missing.length > 0) {
  console.error(
    `❌  gen-brand-paths: simple-icons has no icon for: ${missing.join(', ')}.\n` +
    '   A brand was renamed or removed upstream. Fix the name in ICONS, or drop the\n' +
    '   entry from the integrations page — do not leave a blank icon behind.\n',
  );
  process.exit(1);
}

const lines = ICONS
  .slice()
  .sort()
  .map((name) => `  ${name}: '${simpleIcons[name].path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`);

const body = `/**
 * Brand icon PATH DATA — generated, do not edit.
 *
 * Regenerate with \`npm run gen:brand-paths\` (scripts/gen-brand-paths.mjs), which reads
 * the installed \`simple-icons\` and writes the subset this app renders.
 *
 * It exists because \`simple-icons\` is a single 4.98 MiB module with no per-icon entry
 * points. The integrations page is a SERVER component, so Next resolves that package's
 * CommonJS build for it, and CommonJS cannot be tree-shaken — importing 31 icons pulled
 * all ~3,300 into a shared edge chunk and pushed the Worker over Cloudflare's 10 MiB
 * limit. Only \`.path\` was ever read, so only \`.path\` is kept here.
 *
 * Source: simple-icons (CC0-1.0). The marks themselves remain their owners' trademarks.
 */

export const BRAND_PATHS = {
${lines.join('\n')}
} as const;

export type BrandIconName = keyof typeof BRAND_PATHS;
`;

writeFileSync(outFile, body, 'utf8');
console.log(`✅  brandPaths.ts written — ${ICONS.length} icons, ${(body.length / 1024).toFixed(1)} KB (was a 4.98 MiB barrel import).`);
