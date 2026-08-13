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
];

/** English fallbacks the palette shows before `creationCanvas.shared.label.*` resolves. */
export const SHARED_LABELS: Record<string, string> = {
  funnel: 'Funnel',
};

/** Blank-object status fallbacks under `creationCanvas.shared.status.*`. */
export const SHARED_STATUSES: Record<string, string> = {
  notMeasured: 'Not measured',
};

registerSpecObjectSet({
  id: 'shared',
  namespace: SHARED_NAMESPACE,
  specs: SHARED_OBJECT_SPECS,
});
