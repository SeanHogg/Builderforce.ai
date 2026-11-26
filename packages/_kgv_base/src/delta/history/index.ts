/**
 * The run delta history and trend (PRD 41 §C11.3): props-only list, trend chart and section, plus their labels — and the
 * small shared pieces every run delta host needs beside them (the repository display name, a sheet with a footer).
 * Reached as `@builderforce/knowledge-graph-view/delta/history` (and re-exported from the package root).
 */

export { RunDeltaHistory, type RunDeltaHistoryProps } from './RunDeltaHistory';
export { DeltaHistoryList, type DeltaHistoryListProps } from './DeltaHistoryList';
export { DeltaTrend, type DeltaTrendProps } from './DeltaTrend';
export { BandMark, BAND_TONE, type BlastBand } from './BandMark';
export { footerPanel, RUN_DELTA_PANEL_WIDTH } from './footerPanel';
export { defaultFormatNumber, defaultFormatTime, type DeltaFormatProps } from './formatters';
export { newestFirst, summaryKey, trendModel, TREND_MAX_RUNS, type DeltaTrendModel } from './historyModel';
export {
    DEFAULT_RUN_DELTA_HISTORY_LABELS, RUN_DELTA_HISTORY_NAMESPACE, runDeltaHistoryLabels, type RunDeltaHistoryLabels,
} from './historyLabels';
export { repoDisplayName } from '../repoName';
