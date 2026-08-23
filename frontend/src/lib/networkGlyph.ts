/**
 * ONE glyph per network — the mark that makes a merged list scannable before a label
 * is read.
 *
 * There were THREE copies of this table: the ads panel's, the social panel's, and a
 * loose string-keyed one in `CreationNode` for feed tiles. They had already drifted —
 * the node's map knew five networks and rendered a generic diamond for the other six,
 * so a Reddit tile and a Bluesky tile were the same shape on the same board. Worse,
 * the ads copy was declared exhaustive over a union that had FALLEN BEHIND the API's
 * (`microsoft` shipped as the ninth ad network and nothing here had a mark for it),
 * which is exactly the blank square the exhaustiveness was supposed to prevent.
 *
 * So the table is declared once, over the UNION of both vocabularies, and typed
 * `Record<AdNetwork | SocialNetwork, string>` — a tenth ad network or a twelfth social
 * network now fails to compile HERE, in one file, rather than rendering an anonymous
 * row somewhere nobody is looking.
 *
 * Network names are brand marks, so the glyphs stay literal — they are not translated,
 * for the same reason a logo is not translated. They are always rendered `aria-hidden`
 * beside the network's real label, which IS localized.
 */

import type { AdNetwork } from './adsApi';
import type { SocialNetwork } from './socialApi';

/** Every network either vocabulary can name. Exhaustive by TYPE, deliberately. */
export const NETWORK_GLYPHS: Readonly<Record<AdNetwork | SocialNetwork, string>> = {
  // Paid + organic, where a network is both it is ONE entry — the mark belongs to the
  // brand, not to the port that happens to be reading it.
  x: '𝕏',
  linkedin: 'in',
  facebook: 'f',
  instagram: '◎',
  tiktok: '♪',
  youtube: '▶',
  reddit: '◕',
  pinterest: 'P',
  threads: '@',
  bluesky: '☁',
  googleBusiness: 'G',
  google: 'G',
  meta: '◈',
  snapchat: '◔',
  microsoft: 'M',
};

/** The fallback mark for a network this build has no name for — a value off the wire
 *  rather than out of the type system, e.g. a feed tile persisted by an older build. */
const UNKNOWN_GLYPH = '◈';

/**
 * The glyph for a network, from a value of ANY type.
 *
 * Callers that hold a typed `AdNetwork`/`SocialNetwork` may index {@link NETWORK_GLYPHS}
 * directly and get the compile-time guarantee; this is for the ones holding a string
 * off the wire, where a missing mark must degrade to a shape rather than `undefined`.
 */
export function networkGlyph(network: unknown): string {
  const key = String(network ?? '');
  return (NETWORK_GLYPHS as Record<string, string | undefined>)[key] ?? UNKNOWN_GLYPH;
}
