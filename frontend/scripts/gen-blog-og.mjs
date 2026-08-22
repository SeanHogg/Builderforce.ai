/**
 * gen-blog-og — one Open Graph card per published article, rendered at BUILD time.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 * Every post's `openGraph.images` fell back to the site-wide `/og-image.png`,
 * so 125 articles shared one card. A link to a specific post — in Slack, on
 * LinkedIn, in a newsletter — showed the same generic image as a link to the
 * home page, which is exactly the signal a share is supposed to carry. The card
 * text was described as "lost"; it was never per-article to begin with.
 *
 * ── WHY BUILD TIME AND NOT `next/og` ────────────────────────────────────────
 * `ImageResponse` renders per request through satori + a resvg WASM binary. On
 * the Cloudflare Worker that is a large bundle and a per-share CPU cost, for an
 * image whose inputs (title, date, tag) cannot change between deploys. A PNG
 * written into `public/` is served as a static asset by the CDN, costs the
 * runtime nothing, and is byte-identical for every crawler that asks.
 *
 * Deterministic on purpose: the hue is derived from the slug, so re-running
 * this produces the same bytes and the diff stays empty unless a post changed.
 *
 * Run by `prebuild`. Safe to run repeatedly; it skips a card whose source
 * article has not changed since the PNG was written.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { esc, firstFigure, posterArt } from './lib/figurePoster.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(here, '..', 'src', 'content', 'blog');
const OUT_DIR = resolve(here, '..', 'public', 'blog', 'og');

const WIDTH = 1200;
const HEIGHT = 630;

/** The deep-space ground the whole marketing surface sits on. */
const INK = '#f8fafc';
const MUTED = '#94a3b8';
const BASE = '#050a14';

/** A stable accent per article, so a post's card is recognisably its own. */
function hueFor(slug) {
  const digest = createHash('sha256').update(slug).digest();
  return digest[0] * 360 / 256;
}

/**
 * Greedy wrap at a character budget rather than measured text: the font is not
 * loaded here, and a card that occasionally breaks a line early is a better
 * trade than shipping a font file to measure with.
 */
function wrap(text, perLine, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > perLine && line) { lines.push(line); line = word; } else { line = candidate; }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s.,;:]+$/, '')}…`;
  }
  return lines;
}

/** Front-matter reader. Deliberately tiny — the posts are ours and well-formed. */
function frontMatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * The card.
 *
 * Two layouts, decided by whether the article draws anything. A post with a
 * figure gets that figure as ART and a narrower title column; a post without
 * one keeps the full-width title. The alternative — decorative shapes for
 * everyone — is what produced 125 cards that differed only in their words.
 */
function card({ slug, title, date, tag, figure }) {
  const hue = hueFor(slug);
  const accent = `hsl(${hue.toFixed(0)} 85% 62%)`;
  const accentSoft = `hsl(${hue.toFixed(0)} 85% 62% / 0.16)`;
  const palette = {
    ink: INK,
    muted: MUTED,
    accent,
    good: `hsl(${((hue + 118) % 360).toFixed(0)} 70% 58%)`,
    bad: `hsl(${((hue + 232) % 360).toFixed(0)} 72% 62%)`,
    panel: `hsl(${hue.toFixed(0)} 42% 11%)`,
  };
  const art = posterArt(figure, { x: 610, y: 128, w: 510, h: 372 }, palette);
  const column = art ? 470 : 1040;
  const lines = wrap(title, art ? 24 : 34, 4);
  const size = art ? 42 : 54;
  const step = art ? 52 : 64;
  const startY = (art ? 250 : 300) - (lines.length - 1) * (step / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BASE}"/>
      <stop offset="100%" stop-color="hsl(${hue.toFixed(0)} 45% 12%)"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${WIDTH}" height="8" fill="${accent}"/>
  ${art ? '' : `<circle cx="1050" cy="150" r="190" fill="${accentSoft}"/>`}
  <text x="80" y="120" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="26" font-weight="700" fill="${accent}" letter-spacing="4">${esc((tag || 'BUILDERFORCE').toUpperCase())}</text>
  ${lines.map((line, index) => `<text x="80" y="${startY + index * step}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="${size}" font-weight="800" fill="${INK}" textLength="${Math.min(column, line.length * size * 0.56).toFixed(0)}" lengthAdjust="spacingAndGlyphs">${esc(line)}</text>`).join('\n  ')}
  ${art ? `<g>${figure.title ? `<text x="610" y="108" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="20" font-weight="700" fill="${MUTED}">${esc(figure.title.length > 54 ? `${figure.title.slice(0, 53)}…` : figure.title)}</text>` : ''}${art}</g>` : ''}
  <text x="80" y="556" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="26" font-weight="600" fill="${MUTED}">builderforce.ai${date ? `  ·  ${esc(date)}` : ''}</text>
</svg>`;
}

async function main() {
  if (!existsSync(CONTENT_DIR)) {
    console.log('ℹ️  No blog content directory — nothing to render.');
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const posts = readdirSync(CONTENT_DIR).filter((name) => name.endsWith('.md'));
  let written = 0;
  let skipped = 0;

  for (const file of posts) {
    const slug = file.replace(/\.md$/, '');
    const sourcePath = join(CONTENT_DIR, file);
    const outPath = join(OUT_DIR, `${slug}.png`);
    if (existsSync(outPath) && statSync(outPath).mtimeMs >= statSync(sourcePath).mtimeMs) {
      skipped += 1;
      continue;
    }
    const source = readFileSync(sourcePath, 'utf8');
    const meta = frontMatter(source);
    const tag = (meta.tags ?? '').replace(/^\[|\]$/g, '').split(',')[0]?.trim();
    const png = await sharp(Buffer.from(card({
      slug,
      title: meta.title || slug.replace(/-/g, ' '),
      date: meta.date || '',
      tag,
      figure: firstFigure(source),
    }))).png({ compressionLevel: 9 }).toBuffer();
    writeFileSync(outPath, png);
    written += 1;
  }

  console.log(`✅  Blog OG cards: ${written} rendered, ${skipped} unchanged (${posts.length} posts).`);
}

main().catch((error) => {
  console.error('❌  Blog OG card generation failed:', error);
  process.exit(1);
});
