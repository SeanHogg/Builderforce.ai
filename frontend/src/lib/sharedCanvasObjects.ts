/**
 * Spec-driven kinds that belong to NO single family.
 *
 * ── WHY THIS MODULE EXISTS AT ALL ────────────────────────────────────────────────
 * Two canvas reviews on the same day asked for the same object from opposite ends of
 * the company. Marketing: "sends, clicks and pipeline never join, so ROI is unanswerable
 * on the board." Recruiting: "nothing measures the funnel — no source-of-hire, no stage
 * conversion, no time-to-hire." Those are one object. Building `marketingFunnel` and
 * `hiringFunnel` would have been the twenty-fourth intra-product duplicate the data-model
 * analysis found, created knowingly, on the day it was pointed out.
 *
 * So there is ONE `funnel`, and which funnel a card is bound to is a VALUE
 * (`funnelDomain`) rather than a kind. That is the same open/closed answer migration
 * 0410 gave for connector vendors and `CREATION_OBJECT_KINDS` gives for media types: a
 * new funnel is data, not DDL and not a render branch.
 *
 * A kind belongs here when it is genuinely cross-domain. A kind that only looks generic
 * because nobody has written the second consumer yet belongs to its family.
 */

import { registerSpecObjectSet, SUMMARY_FIELD, type SpecObjectSpec } from './specObjects';

/**
 * Rows out of a `rows` field, whatever the model wrote there.
 *
 * A `rows` value arrives as an array of objects when the model behaves and as
 * anything at all when it does not, and a `derive` that throws takes the whole card
 * down. So every derivation below reads through this rather than trusting the shape.
 */
function rowsOf(value: unknown): ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : [];
}

/** Words in a cell. Whitespace-split, which is close enough for a manuscript figure
 *  and honest about being an estimate rather than a typesetter's count. */
function wordsIn(value: unknown): number {
  return typeof value === 'string' ? value.trim().split(/\s+/).filter(Boolean).length : 0;
}

/** i18n namespace for every cross-domain label, status, field and column. */
export const SHARED_NAMESPACE = 'creationCanvas.shared';

export const SHARED_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  {
    kind: 'funnel',
    icon: '⧗',
    group: 'Insights',
    defaultStatus: 'notMeasured',
    actions: ['measure', 'refresh', 'drill'],
    fields: [
      {
        name: 'funnelDomain',
        render: 'stat',
        label: 'funnelDomain',
        hint: 'Which funnel this measures: hiring | growth | revenue | support. Decides which domain the refresh action reads its stage counts from, so it is required before the card can be anything but authored numbers.',
      },
      {
        name: 'stages',
        render: 'rows',
        label: 'stages',
        columns: ['stage', 'entered', 'exited', 'conversion', 'medianDays'],
        hint: 'One row per stage, in funnel order: {stage, entered, exited, conversion, medianDays}. `conversion` is the percentage of THIS stage that reached the NEXT one — the number that localises a loss, which a cumulative percentage cannot. `medianDays` is time-in-stage and is where a stall shows up before the conversion does.',
      },
      {
        name: 'sourceBreakdown',
        render: 'rows',
        label: 'sourceBreakdown',
        columns: ['source', 'entered', 'converted', 'rate'],
        hint: 'Conversion split by where the entry came from: {source, entered, converted, rate}. This is the row that answers "which channel actually works", and it is the reason budget stops going to the channel someone remembers.',
      },
      { name: 'totalEntered', render: 'stat', label: 'totalEntered', hint: 'Everyone who entered the funnel in the window.', bookkeeping: true },
      { name: 'totalConverted', render: 'stat', label: 'totalConverted', hint: 'Everyone who reached the terminal stage in the window.', bookkeeping: true },
      { name: 'overallConversion', render: 'meter', label: 'overallConversion', hint: '0-100 end-to-end conversion.', bookkeeping: true },
      { name: 'medianCycleDays', render: 'stat', label: 'medianCycleDays', hint: 'Median days from entry to terminal stage — time-to-hire for a hiring funnel, sales-cycle length for a revenue one.', bookkeeping: true },
      { name: 'dateRange', render: 'stat', label: 'dateRange', hint: 'The window measured, e.g. "last 90 days". A funnel with no window is a funnel nobody can reproduce.', bookkeeping: true },
      { name: 'bottleneck', render: 'verdict', label: 'bottleneck', hint: 'The single stage losing the most, named, with the number behind it. One stage — a list of three is a report, and this field is a decision.' },
      { name: 'fetchedAt', render: 'stat', label: 'fetchedAt', hint: 'ISO instant the counts were read.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  {
    // ── THE PUBLICATION PRIMITIVE ────────────────────────────────────────────────
    // A book is not a longer `document`. A document is read on a screen and is done;
    // a book carries a cover, an ordered page list, numbered figures and a print
    // edition, and each of those is a thing the paged harness asks a question about
    // before it may be sold. Adding it as a `document` variant would have meant the
    // print checks either ran on every document or on none.
    kind: 'book',
    icon: '📖',
    // `Knowledge`, beside `document`, because that is where a reader looks for the
    // longer form of the thing they already know how to make. It declared `Create`,
    // which is not a palette section — see the note on `SpecObjectSpec.group`, which is
    // typed now so the next one is a compile error rather than a hidden object.
    group: 'Knowledge',
    defaultStatus: 'manuscript',
    actions: ['read', 'proof', 'export'],
    fields: [
      { name: 'author', render: 'stat', label: 'author', hint: 'Whose name goes on the cover, as it should be printed. Not the account that made it — a ghostwritten book has two different answers and only one of them belongs here.' },
      { name: 'coverImageUrl', render: 'reference', label: 'coverImageUrl', hint: 'The cover artwork. For a print edition it must be 300 dpi at trim size (2480 x 3508 for A4) — the paged harness measures it and refuses the print output below that, because a 72 dpi cover is only discovered after somebody has paid for a parcel.' },
      { name: 'coverDpi', render: 'stat', label: 'coverDpi', hint: 'Effective resolution of the cover at trim size. Write the measured number, not the intent.' },
      {
        name: 'pages', render: 'rows', label: 'pages', columns: ['page', 'heading', 'body', 'figure'],
        hint: 'The book, in order: {page, heading, body, figure}. `page` is the printed folio and must be unique and contiguous — a gap is a page nobody wrote. `figure` names a figure from `figures` by its ref, or is empty. An entry with no body and no figure is an empty page and blocks publication.',
      },
      {
        name: 'figures', render: 'rows', label: 'figures', columns: ['ref', 'caption', 'altText', 'url'],
        hint: 'Illustrations: {ref, caption, altText, url}. `altText` is required by both the EPUB validator and every screen reader, and is the single most-skipped field in a finished manuscript — the harness warns per missing entry rather than once, so the number is visible.',
      },
      { name: 'contents', render: 'rows', label: 'contents', columns: ['chapter', 'title', 'page'], hint: 'Table of contents: {chapter, title, page}. Every `page` must exist in `pages`; a contents entry pointing past the end is a link that 404s inside a paid product.' },
      { name: 'samplePages', render: 'stat', label: 'samplePages', hint: 'How many pages a non-buyer may read. This IS the sales pitch — zero means the listing sells a cover.' },
      { name: 'formats', render: 'chips', label: 'formats', hint: 'Which editions ship: reader | epub | pdf | print. Print is a fulfilment rather than a download and carries its own checks, so listing it commits to the 300 dpi cover.' },
      { name: 'trimSize', render: 'stat', label: 'trimSize', hint: 'Finished page size for the print edition, e.g. "A4" or "6x9in". Absent means digital-only.' },
      // Counted from the rows rather than stored beside them: a page count that can
      // disagree with the page list is the one number a reader will notice is wrong.
      { name: 'pageCount', render: 'stat', label: 'pageCount', hint: 'Pages written. Counted from `pages`, never typed.', derive: (data) => rowsOf(data.pages).length || undefined },
      { name: 'figureCount', render: 'stat', label: 'figureCount', hint: 'Figures placed. Counted from `figures`, never typed.', derive: (data) => rowsOf(data.figures).length || undefined },
      {
        name: 'wordCount', render: 'stat', label: 'wordCount',
        hint: 'Words across every page body. Counted, never typed.',
        derive: (data) => {
          const total = rowsOf(data.pages).reduce((sum, row) => sum + wordsIn(row.body), 0);
          return total || undefined;
        },
      },
      SUMMARY_FIELD,
    ],
  },
];

/** English fallbacks the palette shows before `creationCanvas.shared.label.*` resolves. */
export const SHARED_LABELS: Record<string, string> = {
  funnel: 'Funnel',
  book: 'Book',
};

/** Blank-object status fallbacks under `creationCanvas.shared.status.*`. */
export const SHARED_STATUSES: Record<string, string> = {
  notMeasured: 'Not measured',
  manuscript: 'Manuscript',
};

registerSpecObjectSet({
  id: 'shared',
  namespace: SHARED_NAMESPACE,
  specs: SHARED_OBJECT_SPECS,
});
