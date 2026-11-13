/** The run delta presentation (PRD 41 §C11): props-only card, panel and dimension row, plus their labels. */

export { RunDeltaCard, type RunDeltaCardProps } from './RunDeltaCard';
export { RunDeltaStatusCard, type RunDeltaStatusCardProps } from './RunDeltaStatusCard';
export { HeldNotice, type HeldNoticeProps } from './HeldNotice';
export { RunDeltaPanel, groupFindings, type RunDeltaPanelProps } from './RunDeltaPanel';
export { DimensionRow, lineageCounts, type DimensionRowProps } from './DimensionRow';
export { DeltaFindingItem, type RunDeltaCodeTarget } from './DeltaFindingItem';
export { VerdictMark, VerdictIcon, VERDICT_TONE } from './VerdictMark';
export { ResolveIcon, CopyIcon, DeltaIconButton, type DeltaIconButtonProps } from './DeltaActionIcons';
export { runDeltaDiagnosticsText, resolveDirectiveText } from './deltaActionsText';
export {
    blockingLabel, clauseLabel, dimensionLabel, headlineText, heldRulesText, overrideLabel, releaseConfirmText, lineageGroup, metricLabel, noteLabel, paramLabel, paramValueLabel, metricValueText, quantizedValue, reasonLabel, ruleLabel, verdictLabel,
} from './deltaText';
export { DEFAULT_RUN_DELTA_LABELS, RUN_DELTA_NAMESPACE, labelKey, runDeltaLabels, type RunDeltaLabels } from './labels';
// The view's ONE copy behaviour, reused by the hosts' "Copy diagnostics" (clipboard + Copied / Copy-failed).
export { useCopyText, CopiedNote, CopyFallback, type CopyStatus } from '../copyText';
export {
    RUN_DELTA_CLAUSE_CODES, RUN_DELTA_DYNAMIC_RULE_IDS, RUN_DELTA_EXCLUDED_REASONS, RUN_DELTA_METRIC_IDS, RUN_DELTA_REASON_CODES,
    RUN_DELTA_TOOL_REASON_PREFIXES,
} from './codes';
