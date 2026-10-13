/**
 * @builderforce/interaction-contract
 *
 * The interaction contract shared by the QA telemetry, the session-replay
 * recorder, the API ingest and the Insights views. Source-only: every
 * consumer aliases the bare specifier at this file.
 */

export {
  deriveSelector,
  implicitRole,
  redactInput,
  type RedactableInput,
  type SelectorElement,
} from './selector';

export {
  GRID_PX,
  INTERACTION_KINDS,
  MARK_KINDS,
  isInteractionKind,
  isMarkKind,
  toGridCell,
  type GridCell,
  type InteractionKind,
  type MarkKind,
} from './kinds';

export {
  FRUSTRATION_THRESHOLDS,
  isDeadClickCandidate,
  isExcessiveScroll,
  isInteractiveElement,
  isQuickBack,
  isRageClick,
  type PageSample,
  type PointerSample,
  type ScrollSample,
} from './frustration';

export {
  FILTER_FIELDS,
  FILTER_FIELD_BY_KEY,
  FILTER_OPERATORS,
  filterFromQuery,
  filterToQuery,
  parseReplayFilter,
  type FilterFieldSpec,
  type FilterFieldType,
  type FilterOperator,
  type ReplayFilter,
  type ReplayFilterClause,
} from './filters';

export {
  BUILTIN_SMART_EVENTS,
  markMatchesRule,
  matchingSmartEvent,
  type SmartEventMark,
  type SmartEventMatchKind,
  type SmartEventRule,
} from './smartEvents';

export { hashedAssetUrls, releaseKeyFromAssets } from './release';

export {
  REPLAY_LIMITS,
  VISIT_IDLE_MS,
  VISITOR_ID_PATTERN,
  parseReplayChunk,
  parseReplayVisitMeta,
  type ReplayChunk,
  type ReplayChunkEvent,
  type ReplayMark,
  type ReplayViewport,
  type ReplayVisitMeta,
} from './chunk';

export {
  DEFAULT_REPLAY_SITE_SETTINGS,
  REPLAY_PATHS,
  type CapabilityStateDto,
  type ReplayClientConfig,
  type ReplayCounts,
  type ReplayDeviceClass,
  type ReplayIssueDetailDto,
  type ReplayIssueDto,
  type ReplayIssueStatus,
  type ReplayKeepReason,
  type ReplayKpisDto,
  type ReplayLiveDto,
  type ReplayOpsSummaryDto,
  type ReplayPackDto,
  type ReplayPage,
  type ReplayRecordingDto,
  type ReplayRecordingSummaryDto,
  type ReplayReleaseDto,
  type ReplaySiteDto,
  type ReplaySiteKind,
  type ReplaySiteSettings,
  type ReplaySiteVerifyDto,
  type ReplayUsageDto,
} from './api';
