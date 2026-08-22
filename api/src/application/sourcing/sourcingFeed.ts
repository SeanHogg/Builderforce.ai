/**
 * PARSING A JOB FEED — the pure half of sourcing.
 *
 * ── WHY THIS IS ITS OWN MODULE WITH NO DATABASE AND NO NETWORK ───────────────
 * Everything here is a pure function from bytes to listings. That is what makes
 * the awkward parts testable without a feed, a fixture server or a tenant:
 * CDATA unwrapping, an Atom `<entry>` that is spelled differently from an RSS
 * `<item>`, a JSON API whose array is four levels down under a name the operator
 * configured. Those are where a scraper is actually wrong, and in the source
 * product they were buried inside the same function that opened the socket and
 * wrote the rows, so none of them had a test.
 *
 * ── THE FINGERPRINT IS THE IDENTITY ──────────────────────────────────────────
 * A listing has no id of its own — it is somebody else's HTML. So identity is
 * derived: the canonical URL when there is one, otherwise a hash of
 * title|company|location. That value becomes the `catalog_items.slug`, and
 * `uq_catalog_items_slug (tenant, kind, slug)` turns deduplication into an
 * `onConflictDoNothing` rather than a SELECT-then-INSERT race. The source
 * product did the SELECT, per item, which is both a round trip per row and a
 * duplicate whenever two runs overlapped.
 */
import { sha256Fingerprint } from '../../infrastructure/crypto/digest';

/** One listing as the feed described it, before it is anybody's row. */
export interface SourcedListing {
  title: string;
  description: string;
  company: string;
  location: string;
  url: string;
  jobType: string;
}

export type FeedFormat = 'rss' | 'json';

/** Operator-supplied shaping for a JSON feed: where the array is, and what the
 *  fields are called inside it. Data, not a branch per vendor. */
export interface JsonFeedConfig {
  itemsPath?: string;
  mapping?: Partial<Record<keyof SourcedListing, string>>;
}

/**
 * Parse an RSS 2.0 or Atom feed.
 *
 * Hand-rolled rather than a parser dependency because this runs on Workers,
 * where a DOM parser is not available and every XML library that assumes one is
 * dead weight. The trade is stated: this handles the flat `<item>`/`<entry>`
 * shape job boards actually publish and does not attempt namespaced trees.
 */
export function parseRssFeed(xml: string): SourcedListing[] {
  const listings: SourcedListing[] = [];

  // Atom spells the row `<entry>`; RSS spells it `<item>`. Boards publish both,
  // and the source product read only `<item>` — so every Atom feed an operator
  // added silently produced zero listings and a successful run.
  for (const block of blocks(xml, 'item').concat(blocks(xml, 'entry'))) {
    const title = clean(tag(block, 'title'));
    if (!title) continue;

    listings.push({
      title,
      description: clean(tag(block, 'description') ?? tag(block, 'summary') ?? tag(block, 'content')),
      company: clean(tag(block, 'company') ?? tag(block, 'source') ?? tag(block, 'author')),
      location: clean(tag(block, 'location')),
      // Atom puts the URL in an attribute, not in the element body.
      url: clean(tag(block, 'link')) || linkHref(block),
      jobType: clean(tag(block, 'jobtype') ?? tag(block, 'category')),
    });
  }

  return listings;
}

/** Parse a JSON API response through the operator's field mapping. */
export function parseJsonFeed(data: unknown, config: JsonFeedConfig = {}): SourcedListing[] {
  const rows = at(data, config.itemsPath ?? 'jobs');
  if (!Array.isArray(rows)) return [];

  const map = config.mapping ?? {};
  return rows.flatMap((row) => {
    const pick = (field: keyof SourcedListing, fallback: string) =>
      str(at(row, map[field] ?? fallback));
    const title = pick('title', 'title');
    if (!title) return [];
    return [{
      title,
      description: pick('description', 'description'),
      company: pick('company', 'company'),
      location: pick('location', 'location'),
      url: pick('url', 'url'),
      jobType: pick('jobType', 'jobType'),
    }];
  });
}

/**
 * The stable identity of a listing.
 *
 * A URL is preferred because it is the board's own identity for the row and
 * survives a re-titled posting. When there is none, the hash of the three fields
 * that together name a job is the next best thing — and it is prefixed so a
 * fingerprinted slug can never collide with a URL-derived one.
 */
export async function listingSlug(listing: SourcedListing): Promise<string> {
  if (listing.url) return `u:${await sha256Fingerprint(listing.url.trim().toLowerCase(), 40)}`;
  const raw = [listing.title, listing.company, listing.location]
    .map((part) => part.trim().toLowerCase()).join('|');
  return `f:${await sha256Fingerprint(raw, 40)}`;
}



// ── XML helpers ────────────────────────────────────────────────────────────

function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi'))]
    .map((m) => m[1] ?? '');
}

function tag(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1]?.trim();
}

/** Atom: `<link href="…"/>` — a self-closing element with no body. */
function linkHref(xml: string): string {
  return xml.match(/<link[^>]*\shref=["']([^"']+)["']/i)?.[1]?.trim() ?? '';
}

function clean(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    // Entities survive CDATA stripping and read as literal `&amp;` in a title.
    .replace(/&(?:amp|#38);/g, '&')
    .replace(/&(?:lt|#60);/g, '<')
    .replace(/&(?:gt|#62);/g, '>')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Path helpers ───────────────────────────────────────────────────────────

/** Walk a dotted path. Returns undefined rather than throwing on any miss — an
 *  operator's mapping is a guess about somebody else's payload, and a wrong
 *  guess must skip a field, not fail the run. */
function at(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]),
    value,
  );
}

function str(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // An object here is a mapping pointed at the wrong level. `[object Object]` in
  // a job title is worse than an empty one, because it looks like real data.
  return '';
}
