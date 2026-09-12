/**
 * Publishes the blog's TRANSLATED article bodies under `public/blog-i18n/`.
 *
 * Source convention (resolved in ONE place, `src/lib/blogLocale.ts`):
 *
 *     src/content/blog/<slug>.md           the English post (front-matter + body)
 *     src/content/blog/<slug>.<locale>.md  its body in <locale> (body only)
 *
 * WHY this exists: the translated bodies are ~5 MB of markdown. Imported the way
 * the English posts are, they would ride into every edge function that can reach
 * `blogData` — the failure that already moved the message catalogs out of the
 * bundle (see `publish-message-catalogs.mjs`). They are DATA, so they ship as
 * static assets and the post route fetches the one a request needs:
 *
 *     public/blog-i18n/<locale>/<slug>.md
 *
 * Run from `dev` and `prebuild`, so a deploy always carries bodies matching the
 * source. Output is gitignored for the same reason, and PRUNED — a translation
 * deleted from source must not keep serving from a stale published copy.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'content', 'blog');
const OUT = path.join(ROOT, 'public', 'blog-i18n');

/** `<slug>.<locale>.md` — slugs are kebab-case and never contain a dot. */
const TRANSLATED = /^([a-z0-9-]+)\.([a-z]{2})\.md$/;

function main() {
  if (!fs.existsSync(SRC)) {
    console.log('[blog-i18n] no blog content directory — nothing to publish.');
    return;
  }

  const expected = new Set();
  let bytes = 0;
  for (const file of fs.readdirSync(SRC)) {
    const match = file.match(TRANSLATED);
    if (!match) continue;
    const [, slug, locale] = match;
    // A translation of nothing is a typo in a file name, and it would publish a
    // body no route can ever ask for. Fail where the file name is in hand.
    if (!fs.existsSync(path.join(SRC, `${slug}.md`))) {
      console.error(`[blog-i18n] ${file} has no English original (${slug}.md).`);
      process.exitCode = 1;
      continue;
    }
    const body = fs.readFileSync(path.join(SRC, file), 'utf8');
    const dir = path.join(OUT, locale);
    const to = path.join(dir, `${slug}.md`);
    fs.mkdirSync(dir, { recursive: true });
    // Skip an unchanged write so repeat runs stay cheap.
    if (!fs.existsSync(to) || fs.readFileSync(to, 'utf8') !== body) fs.writeFileSync(to, body, 'utf8');
    expected.add(to);
    bytes += Buffer.byteLength(body);
  }

  let pruned = 0;
  if (fs.existsSync(OUT)) {
    for (const locale of fs.readdirSync(OUT)) {
      const dir = path.join(OUT, locale);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const file of fs.readdirSync(dir)) {
        const full = path.join(dir, file);
        if (!expected.has(full)) { fs.rmSync(full); pruned += 1; }
      }
    }
  }

  console.log(`[blog-i18n] published ${expected.size} translated article(s) to public/blog-i18n/ (${(bytes / 1024 / 1024).toFixed(2)} MiB${pruned ? `, pruned ${pruned} stale` : ''}).`);
}

main();
