/**
 * Front-matter of a blog post's English original — the one parser for every build
 * script that reads `src/content/blog/<slug>.md` (`publish-blog-content.mjs`,
 * `gen-blog-og.mjs`). The runtime never parses front-matter: it reads the index
 * `publish-blog-content.mjs` generates from this.
 */

/** Scalars by key, with one pair of matching surrounding YAML quotes stripped — a
 *  value containing `: ` must be quoted, and the quotes are syntax, not copy. */
export function blogFrontMatter(raw) {
  const meta = {};
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return meta;
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }
  return meta;
}

/** A front-matter tag list: `[a, b]` → ['a', 'b']; a bare scalar is one tag. */
export function blogTags(value) {
  if (!value) return [];
  const inline = value.match(/^\[(.*)\]$/);
  return inline ? inline[1].split(',').map((tag) => tag.trim()).filter(Boolean) : [value];
}
