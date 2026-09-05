/**
 * @seanhogg/builderforce-brain-ui — the shared React UI for the BuilderForce
 * Brain. The single source of truth for the chat transcript experience, rendered
 * identically on the web app and inside the VS Code webview.
 *
 * Import the stylesheet once per host: `@seanhogg/builderforce-brain-ui/styles.css`
 * and map the `--bf-*` theme variables to your host's tokens.
 */

export { BrainTimeline, DEFAULT_TIMELINE_LABELS } from './BrainTimeline';
export type { BrainTimelineProps, BrainTimelineLabels, MessageRating } from './BrainTimeline';

// The ANIMATED in-flight row — what the run is doing right now. Rendered by the
// timeline; exported for surfaces (a status bar, a dock header) that want the same
// indicator without the transcript around it.
export { LiveActivity, DEFAULT_LIVE_ACTIVITY_LABELS, formatElapsed, SLOW_AFTER_MS } from './LiveActivity';
export type { LiveActivityProps, LiveActivityLabels } from './LiveActivity';

export { Markdown } from './Markdown';
export type { MarkdownProps, MarkdownLabels } from './Markdown';
export { splitThinkSegments } from './thinkBlocks';
export type { ThinkSegment } from './thinkBlocks';

export {
  QuestionCard,
  PendingQuestionBanner,
  selectPendingAskUser,
  askUserAnchorId,
  parseAskUser,
  stripAskUser,
  serializeAskUser,
  DEFAULT_ASK_USER_LABELS,
} from './askUser';
export type { AskUserPayload, AskUserOption, AskUserLabels, PendingAskUser } from './askUser';

// The chat error banner: the message AND the remedy the server named (reconnect /
// upgrade / add a card). Shared so the VS Code webview and the web app's BrainPanel
// can't drift on what a given entitlement failure lets the user do about it.
export { ChatErrorBanner, DEFAULT_CHAT_ERROR_LABELS } from './ChatErrorBanner';
export type { ChatErrorBannerProps, ChatErrorBannerLabels } from './ChatErrorBanner';

export { PromptPanel } from './PromptPanel';
export type { PromptPanelProps } from './PromptPanel';

// The composer's `/` control — run shaping, the model in use, and the model
// picker in ONE affordance, so no host grows a second "which model" chip beside it.
export { PromptOptionsMenu } from './promptOptions/PromptOptionsMenu';
export type {
  PromptOptionsMemory,
  PromptOptionsAutoMode,
  PromptOptionsMenuProps,
  PromptOptionsMode,
  PromptOptionsModeChoice,
  PromptOptionsModel,
  PromptOptionsSession,
} from './promptOptions/PromptOptionsMenu';
export { DEFAULT_PROMPT_OPTIONS_LABELS, promptOptionsLabels } from './promptOptions/types';
export type { PromptOptionsLabels } from './promptOptions/types';
// The model-choice domain itself lives in brain-embedded (the extension host shares
// it and cannot import React); re-exported here so a UI consumer has one import site.
export type {
  ChatModelOptions,
  ChatModelSelection,
  ModelCategory,
  ModelChoiceLabels,
  ModelIdentityContext,
  ModelItem,
  RoutedProduct,
} from '@seanhogg/builderforce-brain-embedded';
export {
  buildModelItems,
  filterModelItems,
  activeModelKey,
  modelCategoryLabel,
  modelInUse,
  premiumCostLabel,
  perMillionUsd,
  byoVendorLabel,
  MODEL_CATEGORIES,
  PROJECT_EVERMIND_MODEL_PREFIX,
  // Model-identity masking: the routed product a viewer is told they run on.
  BUILDERFORCE_PRODUCT_NAME,
  DEFAULT_MODEL_IDENTITY,
  displayModelName,
  productForPlan,
  productModelName,
  revealsModelId,
} from '@seanhogg/builderforce-brain-embedded';

export { Avatar, ParticipantBadge, initialsOf, avatarColor } from './ParticipantBadge';
export type { AvatarProps } from './ParticipantBadge';

export { HealthRing, healthRingColor } from './HealthRing';
export type { HealthRingProps } from './HealthRing';

export { ChatTicketsPanel } from './chatTickets/ChatTicketsPanel';
export type { ChatTicketsPanelProps } from './chatTickets/ChatTicketsPanel';
export { useChatParticipants } from './chatTickets/useChatParticipants';
export { useMentionAutocomplete } from './mention/MentionAutocomplete';
export type { MentionAutocomplete, MentionLabels, UseMentionAutocompleteOptions } from './mention/MentionAutocomplete';
export { DEFAULT_CHAT_TICKETS_LABELS, TICKET_KINDS, RUNNABLE_KINDS } from './chatTickets/types';
export type {
  ChatTicketsAdapter,
  ChatTicketsLabels,
  TicketKind,
  LinkType,
  TicketLinkVM,
  LineageVM,
  ChatAgentVM,
  AgentOptionVM,
  TicketOptionVM,
  ChatOptionVM,
} from './chatTickets/types';

export {
  buildTimeline,
  buildSettledTimeline,
  streamingNode,
  attachmentsOf,
  formatDuration,
  formatPayload,
} from './timelineModel';
export type { TimelineNode, TimelineImage, BuildTimelineInput } from './timelineModel';

export { EvermindConsole } from './evermind/EvermindConsole';
export type { EvermindConsoleProps } from './evermind/EvermindConsole';
export { DEFAULT_EVERMIND_LABELS } from './evermind/types';
export { evermindLearnedStatus } from './evermind/learnedStatus';
export type { EvermindLearnedStatus, EvermindTeacherSkipReason, LearnedStatusInput } from './evermind/learnedStatus';
export { evermindNextAction } from './evermind/actionGuide';
export type { EvermindActionGuideInput, EvermindActionId, EvermindNextAction } from './evermind/actionGuide';
export type {
  EvermindConsoleAdapter,
  EvermindConsoleLabels,
  EvermindConsoleData,
  EvermindContributionState,
  EvermindContributionStatus,
  EvermindTeachResult,
  EvermindMode,
  EvermindRecentEntry,
  EvermindSeedModel,
  EvermindTarget,
  EvermindTeacherOptions,
  EvermindValidateMatch,
  EvermindValidateResult,
  EvermindProbeSample,
  EvermindProbeResult,
  EvermindKnowledgeVerdict,
  EvermindKnowledgeFinding,
  EvermindKnowledgeAnalysis,
  EvermindKnowledgeRepair,
  EvermindCleanupResult,
  EvermindReindexResult,
} from './evermind/types';

export { Project360View } from './project360/Project360View';
export type { Project360ViewProps } from './project360/Project360View';
export { Sunburst } from './project360/Sunburst';
export type { SunburstProps } from './project360/Sunburst';
export { DEFAULT_PROJECT360_LABELS } from './project360/types';
export type {
  Project360,
  Project360Action,
  Project360Dimension,
  Project360Gap,
  Project360Labels,
  Project360Member,
  Project360Pillar,
  HealthTier,
} from './project360/types';

export { ProjectListView } from './projectList/ProjectListView';
export type { ProjectListViewProps } from './projectList/ProjectListView';
export { DEFAULT_PROJECT_LIST_LABELS } from './projectList/types';
export type {
  ProjectListModel,
  ProjectListGroup,
  ProjectListItem,
  ProjectListBadge,
  ProjectListAction,
  ProjectListTicketRef,
  ProjectListLabels,
  ProjectListTone,
} from './projectList/types';
