/**
 * @builderforce/interaction-contract
 *
 * The interaction contract shared by the QA telemetry, the session-replay
 * recorder, the API ingest and the Insights views (PRD 33 §3.4). Source-only:
 * every consumer aliases the bare specifier at this file. `sideEffects: false`
 * lets the recorder's loader pull in only what it uses.
 */

export {
  deriveSelector,
  redactInput,
  type RedactableInput,
  type SelectorElement,
} from './selector';

export {
  FRUSTRATION_MARK_KINDS,
  GRID,
  MARK_KINDS,
  isMarkKind,
  toGridCell,
  type FrustrationMarkKind,
  type GridCell,
  type MarkKind,
} from './kinds';

export {
  FRUSTRATION_THRESHOLDS,
  isDeadClickCandidate,
  isExcessiveScroll,
  isQuickBack,
  isRageClick,
  type PageSample,
  type PointerSample,
  type ScrollSample,
} from './frustration';

export {
  KEEP_REASONS,
  REPLAY_LIMITS,
  REPLAY_STRING_LIMITS,
  VISIT_IDLE_MS,
  VISITOR_ID_PATTERN,
  VITAL_BUCKETS,
  VITAL_METRICS,
  p75FromHistogram,
  parseReplayChunk,
  vitalBucket,
  type KeepReason,
  type ReplayChunk,
  type ReplayDevice,
  type ReplayIdentify,
  type ReplayMark,
  type VitalMetric,
} from './chunk';

export { fnv1a64, issueFingerprint, routeTemplate, type IssueFingerprintInput } from './route';

export {
  EMPTY_REPLAY_FILTER,
  FILTER_FIELDS,
  FILTER_FIELD_BY_ID,
  FILTER_FIELD_IDS,
  FILTER_OPS,
  MAX_FILTER_CLAUSES,
  MAX_FILTER_LIST,
  MAX_FILTER_VALUE,
  filterFromQuery,
  filterToQuery,
  parseReplayFilter,
  type FilterFieldId,
  type FilterFieldSpec,
  type FilterOp,
  type FilterScalar,
  type FilterValueKind,
  type ReplayFilter,
  type ReplayFilterClause,
} from './filters';

export {
  BUILTIN_SMART_EVENTS,
  BUILTIN_SMART_EVENT_NAMES,
  GOAL_SMART_EVENTS,
  markMatchesRule,
  smartEventsForMark,
  type BuiltinSmartEventName,
  type SmartEventMark,
  type SmartEventMatchMode,
  type SmartEventRule,
  type SmartEventRuleKind,
} from './smartEvents';

export { releaseKeyFromAssets } from './release';

export {
  REPLAY_API_ORIGIN,
  REPLAY_CDN_ORIGIN,
  REPLAY_EMBED_PATH,
  REPLAY_LOADER_PATH,
  REPLAY_MANIFEST_PATH,
  REPLAY_NPM_PACKAGE,
  REPLAY_PLAYER_GLOBAL,
  replayLoaderUrl,
  replaySnippets,
  type ReplayManifest,
  type ReplaySnippets,
} from './snippets';

/** The read/write API DTOs and the path table — every export of `api.ts`. */
export * from './api';
