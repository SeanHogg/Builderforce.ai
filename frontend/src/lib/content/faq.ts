import { contentKey, rawList, type CopyReader } from './copy';

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * The FAQ sets that exist only as marketing copy — no page section owns them —
 * each a localized array at `marketing.content.faq.<set>`.
 *
 * - `homepage` is the CRAWLER's list: the page renders the shorter
 *   `home.homepageFaq`, and `homepageSchema()` emits this longer one for rich
 *   snippet coverage.
 * - `login` / `register` / `freelancer` are rendered by the auth panels.
 * - `pricing`, `blog`, `projectsTasks` are emitted as FAQPage JSON-LD (and
 *   `projectsTasks` is also the `/projects` teaser's FAQ).
 *
 * FAQs that a page section DOES own are read from that section's namespace —
 * `evermind.faq`, `compare.arenas.<key>.faq` — through {@link faqAt}, so the
 * FAQPage a crawler receives is the list the reader sees.
 */
export const FAQ_SETS = ['homepage', 'pricing', 'login', 'register', 'freelancer', 'blog', 'projectsTasks'] as const;

export type FaqSet = (typeof FAQ_SETS)[number];

/** Catalog key of a marketing FAQ set. */
export function faqKey(set: FaqSet): string {
  return contentKey(`faq.${set}`);
}

/** A marketing FAQ set, localized by the reader it is resolved through. */
export function faqItems(t: CopyReader, set: FaqSet): FaqItem[] {
  return faqAt(t, faqKey(set));
}

/** Any catalog FAQ array (`{ question, answer }[]`) at an absolute key. */
export function faqAt(t: CopyReader, key: string): FaqItem[] {
  return rawList<FaqItem>(t, key).filter((item) => Boolean(item?.question && item?.answer));
}
