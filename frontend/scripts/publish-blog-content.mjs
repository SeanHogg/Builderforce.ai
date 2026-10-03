/**
 * Publishes the blog corpus as DATA: every article body as a static asset, and one
 * metadata index the app imports.
 *
 * Source convention (resolved at runtime in ONE place, `src/lib/blogLocale.ts`):
 *
 *     src/content/blog/<slug>.md           the English post (front-matter + body)
 *     src/content/blog/<slug>.<locale>.md  its body in <locale> (body only)
 *
 * Outputs:
 *
 *     public/blog-i18n/<locale>/<slug>.md  every body, English included (`en/`)
 *     src/lib/blogIndex.generated.json     every post's front-matter, newest-first
 *
 * WHY bodies are assets and not imports: the corpus is ~1.2 MB of English and ~5 MB
 * of translations. Imported, the English rode into every CLIENT bundle that showed a
 * post card — the home page, the blog index, every marketing page with related
 * reading — and into every edge function that could reach `blogData`. Only the post
 * page needs a body, and it needs exactly one, so the route's server render fetches
 * the one a request asks for.
 *
 * WHY the index is generated from the directory: it used to be a hand-kept list of
 * 154 imports in `blogData.ts`, and posts written without a matching line there
 * shipped their OG cards (which `gen-blog-og.mjs` derives from the directory) and
 * 404'd as articles. The directory is now the one registry for all three.
 *
 * The bodies are gitignored and PRUNED (a post deleted from source must not keep
 * serving); run from `dev` and `prebuild`. The index is COMMITTED, because the
 * typecheck, the tests and every build import it before any script has run — and
 * `--check` (in `scripts/checks.manifest.mjs`, so `npm test` and the deploy run it)
 * fails when it no longer matches the directory, which is what keeps a committed
 * copy honest.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blogFrontMatter, blogTags } from './lib/blogFrontMatter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'content', 'blog');
const OUT = path.join(ROOT, 'public', 'blog-i18n');
const INDEX = path.join(ROOT, 'src', 'lib', 'blogIndex.generated.json');
const DEFAULT_LOCALE = 'en';

/** `<slug>.md` (English original) or `<slug>.<locale>.md` (a translated body).
 *  Slugs are kebab-case and never contain a dot. */
const ORIGINAL = /^([a-z0-9-]+)\.md$/;
const TRANSLATED = /^([a-z0-9-]+)\.([a-z]{2})\.md$/;

/** Every source file as { slug, locale, file }, rejecting a translation of nothing —
 *  a typo in a file name that would publish a body no route can ever ask for. */
function readSources() {
  if (!fs.existsSync(SRC)) return [];
  const files = fs.readdirSync(SRC);
  const originals = new Set(files.map((file) => file.match(ORIGINAL)?.[1]).filter(Boolean));
  const sources = [];
  for (const file of files) {
    const original = file.match(ORIGINAL);
    const translated = original ? null : file.match(TRANSLATED);
    if (!original && !translated) continue;
    const slug = original ? original[1] : translated[1];
    if (translated && !originals.has(slug)) {
      console.error(`[blog] ${file} has no English original (${slug}.md).`);
      process.exitCode = 1;
      continue;
    }
    sources.push({ slug, locale: original ? DEFAULT_LOCALE : translated[2], file });
  }
  return sources;
}

/** The index as it would be written: front-matter of every English original,
 *  newest first, slug as the tie-break so the order is stable across file systems. */
function renderIndex(sources) {
  const index = sources
    .filter((source) => source.locale === DEFAULT_LOCALE)
    .map(({ slug, file }) => {
      const meta = blogFrontMatter(fs.readFileSync(path.join(SRC, file), 'utf8'));
      return {
        slug,
        title: meta.title ?? slug,
        date: meta.date ?? '',
        description: meta.description ?? '',
        tags: blogTags(meta.tags ?? ''),
        author: meta.author ?? '',
      };
    })
    .sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1));
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** Write only when the content changed, so repeat runs stay cheap and do not touch
 *  mtimes a watcher would react to. */
function writeIfChanged(to, content) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!fs.existsSync(to) || fs.readFileSync(to, 'utf8') !== content) fs.writeFileSync(to, content, 'utf8');
}

/** Normalise line endings so a CRLF checkout of the committed index is not "stale". */
const lf = (text) => text.replace(/\r\n/g, '\n');

function check() {
  const expected = renderIndex(readSources());
  const actual = fs.existsSync(INDEX) ? lf(fs.readFileSync(INDEX, 'utf8')) : '';
  if (actual !== expected) {
    console.error('[blog] src/lib/blogIndex.generated.json is out of date with src/content/blog/. Run `node scripts/publish-blog-content.mjs` and commit the result.');
    process.exitCode = 1;
    return;
  }
  console.log('[blog] post index matches src/content/blog/.');
}

function publish() {
  const sources = readSources();
  const expected = new Set();
  let bytes = 0;
  for (const { slug, locale, file } of sources) {
    const raw = fs.readFileSync(path.join(SRC, file), 'utf8');
    const to = path.join(OUT, locale, `${slug}.md`);
    writeIfChanged(to, raw);
    expected.add(to);
    bytes += Buffer.byteLength(raw);
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

  const index = renderIndex(sources);
  writeIfChanged(INDEX, index);
  const posts = sources.filter((source) => source.locale === DEFAULT_LOCALE).length;
  console.log(`[blog] indexed ${posts} post(s); published ${expected.size} bod${expected.size === 1 ? 'y' : 'ies'} to public/blog-i18n/ (${(bytes / 1024 / 1024).toFixed(2)} MiB${pruned ? `, pruned ${pruned} stale` : ''}).`);
}

if (process.argv.includes('--check')) check();
else publish();
