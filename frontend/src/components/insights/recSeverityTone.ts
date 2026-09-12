import type { RecSeverity } from '@/lib/recommendationsApi';
import type { StatusToneMap } from '@/lib/statusTone';

/**
 * A recommendation's severity, as a status tone — the ONE mapping the full
 * Recommendations lens and the dashboard's compact summary both colour by.
 *
 * A leaf of its own rather than an export of `RecommendationsLens.tsx`: the summary is
 * in the root layout's static closure (the AI insight panel registry is mounted by the
 * shell), and importing this constant from the lens dragged the whole lens — its
 * reads, its dismiss flow, its cards — into the first paint of every route to read
 * three words.
 */
export const REC_SEVERITY_TONE: StatusToneMap<RecSeverity> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};
