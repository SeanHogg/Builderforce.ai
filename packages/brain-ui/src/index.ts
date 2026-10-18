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
// The ONE catalog → label table every host reads its transcript copy through.
export { timelineCatalogLookup, timelineLabelsFrom, liveActivityLabelsFrom, chatActivityLabelsFrom } from './timelineCatalog';
export type { TimelineCatalogLookup } from './timelineCatalog';

// ONE settled tool step — outcome, subject, and (for a shell call) the command and
// its terminal output. Rendered by the timeline; exported with its own narrow label
// contract so a surface can show a single step outside a transcript, and so the
// command/terminal derivation is testable without a DOM.
export { ToolStep } from './ToolStep';
export type { ToolStepLabels, ToolStepNode } from './ToolStep';
export { toolStepView, commandOf, shellOutcomeOf, toolPreview } from './toolStepView';
export type { ToolStepView, CommandRun, ToolPreview } from './toolStepView';
export { CopyButton } from './CopyButton';
export type { CopyLabels } from './CopyButton';

// The ANIMATED in-flight row — what the run is doing right now. Rendered by the
// timeline; exported for surfaces (a status bar, a dock header) that want the same
// indicator without the transcript around it.
export { LiveActivity, DEFAULT_LIVE_ACTIVITY_LABELS, formatElapsed, SLOW_AFTER_MS } from './LiveActivity';
export type { LiveActivityProps, LiveActivityLabels } from './LiveActivity';

export { Markdown } from './Markdown';
export type { MarkdownProps, MarkdownLabels } from './Markdown';

// The chat's OWN name, edited in place in the surface header — one component for the
// web Brain panel, the editor's chat surface and Rovr, so the Enter/Escape/blank rules
// cannot drift between them.
export { InlineChatTitle, DEFAULT_INLINE_CHAT_TITLE_LABELS } from './inlineTitle/InlineChatTitle';
export type { InlineChatTitleProps, InlineChatTitleLabels } from './inlineTitle/InlineChatTitle';

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
export type { AskUserPayload, AskUserOption, AskUserLabels, PendingAskUser, AskUserMessageLike } from './askUser';

// The chat error banner: the message AND the remedy the server named (reconnect /
// upgrade / add a card). Shared so the VS Code webview and the web app's BrainPanel
// can't drift on what a given entitlement failure lets the user do about it.
export { ChatErrorBanner, DEFAULT_CHAT_ERROR_LABELS } from './ChatErrorBanner';
// The ONE human-in-the-loop approval bar (a run paused on `pendingConfirm`) — web panel,
// VS Code chat + sub-agent strip and Rovr all render this, each with its own copy/slots.
export { ToolConfirmBar, DEFAULT_TOOL_CONFIRM_LABELS, toolConfirmPreview } from './ToolConfirmBar';
// THE surface chrome every AI host wears: the Brain mark (with its working pulse) and the
// one-row header (mark · name · context · presence · actions · history · new · expand · close).
export { BrainMark } from './surface/BrainMark';
export type { BrainMarkProps } from './surface/BrainMark';
export { SurfaceHeader, HeaderIcon, EXPAND_ICON_PATH, DEFAULT_SURFACE_HEADER_LABELS } from './surface/SurfaceHeader';
export type { SurfaceHeaderProps, SurfaceHeaderLabels, SurfaceHeaderHistory } from './surface/SurfaceHeader';
export { SurfaceLauncher } from './surface/SurfaceLauncher';
export type { SurfaceLauncherProps, SurfaceLauncherBadge } from './surface/SurfaceLauncher';
export { SurfaceTabs } from './surface/SurfaceTabs';
export type { SurfaceTabsProps, SurfaceTab } from './surface/SurfaceTabs';
// THE body (header · rail · thread/empty · notices · footer), its pinned footer, the
// empty state with its starter tiles, and the chat-history rows — moved from the web panel.
export { AiSurface } from './surface/AiSurface';
export type { AiSurfaceProps } from './surface/AiSurface';
export { SurfaceFooter } from './surface/SurfaceFooter';
export type { SurfaceFooterProps } from './surface/SurfaceFooter';
export { SurfaceEmptyState } from './surface/SurfaceEmptyState';
export type { SurfaceEmptyStateProps } from './surface/SurfaceEmptyState';
export { StarterGroup, StarterTile } from './surface/StarterTiles';
export type { StarterTileProps } from './surface/StarterTiles';
export { ChatHistoryList, ChatHistoryRow, DEFAULT_CHAT_HISTORY_LABELS } from './surface/ChatHistory';
export type { ChatHistoryListProps, ChatHistoryRowProps, ChatHistoryLabels, ChatHistoryChat } from './surface/ChatHistory';
// THE row state + actions every host's history rows bind through (held above the list).
export { useChatRowActions } from './surface/useChatRowActions';
export type { UseChatRowActionsOptions, ChatRowActions, ChatRowActionProps, ChatRowRef } from './surface/useChatRowActions';
// A run notice the person can dismiss until a NEW occurrence (keyed on the value set).
export { useDismissibleNotice } from './surface/useDismissibleNotice';
// Composer chips, extracted from the hosts: fixed next-step suggestions (web), the held
// turns with Steer now (VS Code), and the WHERE chip (the canvas scope).
export { SuggestionRow } from './composer/SuggestionRow';
export type { ComposerSuggestion } from './composer/SuggestionRow';
export { QueuedTurnChips, DEFAULT_QUEUED_TURN_LABELS } from './composer/QueuedTurnChips';
export type { QueuedTurnChipsProps, QueuedTurnChipsLabels } from './composer/QueuedTurnChips';
export { ContextChip } from './composer/ContextChip';
export type { ContextChipProps, ContextChipOption } from './composer/ContextChip';
export type { ToolConfirmBarProps, ToolConfirmBarLabels } from './ToolConfirmBar';
export type { ChatErrorBannerProps, ChatErrorBannerLabels } from './ChatErrorBanner';

export { PromptPanel } from './PromptPanel';
export type { PromptPanelProps } from './PromptPanel';
// The composer's ONE trailing button (mic / Send / Stop) and the dictation behind it.
export { promptTrailingAction } from './promptTrailingAction';
export type { PromptTrailingAction, PromptTrailingState } from './promptTrailingAction';
export { useVoiceDictation } from './useVoiceDictation';

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
// The on-device model list (PRD 34): the page engines' catalog rows a person downloads,
// runs and removes — presentational row + list, the hook over a host's local model store,
// and their copy. The `/` menu's Model tab renders them; Rovr's side panel reuses them.
export { LocalModelRow } from './localModels/LocalModelRow';
export type { LocalModelRowProps } from './localModels/LocalModelRow';
export { LocalModelList } from './localModels/LocalModelList';
export type { LocalModelListProps } from './localModels/LocalModelList';
export { useLocalModels } from './localModels/useLocalModels';
export type { LocalModelsState } from './localModels/useLocalModels';
export { DEFAULT_LOCAL_MODEL_LABELS, LOCAL_MODEL_LABEL_FIELDS, LOCAL_UNSUPPORTED_LABEL, localModelLabelsFrom } from './localModels/labels';
export type { LocalModelLabels, LocalModelLabelLookup } from './localModels/labels';
export { formatDownloadSize, formatParams, formatContextTokens } from './localModels/localModelView';
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

export { Avatar, RecipientsBadge, initialsOf, avatarColor } from './ParticipantBadge';
export type { AvatarProps } from './ParticipantBadge';

// The composer's "who" controls — ONE recipient ("To") and ONE persona ("Acting as")
// picker for the web composer and the VS Code webview, on one popover primitive.
export { usePopover } from './popover/usePopover';
export { RecipientPicker, DEFAULT_RECIPIENT_PICKER_LABELS } from './recipient/RecipientPicker';
export type { RecipientPickerProps, RecipientPickerLabels } from './recipient/RecipientPicker';
export { useRecipientChoice } from './recipient/useRecipientChoice';
export { PersonaPicker, DEFAULT_PERSONA_PICKER_LABELS } from './persona/PersonaPicker';
export type { PersonaPickerProps, PersonaPickerLabels, PersonaModalityOption } from './persona/PersonaPicker';

export { HealthRing, healthRingColor } from './HealthRing';
export type { HealthRingProps } from './HealthRing';

// The chat's "this turn left code on disk" list — the drawer behind the ticket rail's
// "Changes (N)" pill (a ChatTicketsExtension the host registers). Self-gating, so a
// surface with no local working tree passes no changes and it never renders.
export {
  PendingChangesList,
  DEFAULT_PENDING_CHANGES_LABELS,
  resolvePendingChangesLabels,
  pendingChangesSummary,
} from './pendingChanges/PendingChangesList';
export type {
  PendingChangesListProps,
  PendingChangesLabels,
  PendingChangeVM,
  PendingChangeKind,
} from './pendingChanges/PendingChangesList';

export { ChatTicketsPanel } from './chatTickets/ChatTicketsPanel';
export type { ChatTicketsPanelProps } from './chatTickets/ChatTicketsPanel';
export type { ChatTicketsExtension } from './chatTickets/types';
// The chat↔ticket REST client, ONE implementation. The web app and the VS Code
// webview each carried a hand-written copy, and the VSIX one had lost the run’s
// chat binding entirely — see chatTickets/restAdapter.ts.
export { chatSwitcherLabel } from './chatTickets/chatSwitcherLabel';
export { createChatTicketsRestAdapter } from './chatTickets/restAdapter';
export type { ChatTicketsRequest, ChatTicketsRestOptions } from './chatTickets/restAdapter';
export { useChatParticipants } from './chatTickets/useChatParticipants';
export { useChatActivitySignal } from './chatTickets/useChatActivitySignal';
export { useMentionAutocomplete } from './mention/MentionAutocomplete';
export type { MentionAutocomplete, MentionLabels, UseMentionAutocompleteOptions } from './mention/MentionAutocomplete';
export { useTicketAutocomplete } from './mention/TicketAutocomplete';
export type { TicketAutocomplete, TicketAutocompleteLabels, UseTicketAutocompleteOptions } from './mention/TicketAutocomplete';
export { DEFAULT_CHAT_TICKETS_LABELS, TICKET_KINDS, RUNNABLE_KINDS } from './chatTickets/types';
export { chatTicketsLabelsFromBundle } from './chatTickets/labelBundle';
export { chatDiagnosticsReads } from './chatTickets/chatDiagnosticsReads';
export type { ChatDiagnosticsChatReads, ChatDiagnosticsReadAdapter } from './chatTickets/chatDiagnosticsReads';
export type {
  ChatTicketsAdapter,
  ChatTicketsLabels,
  TicketKind,
  LinkType,
  TicketLinkVM,
  TicketParentVM,
  LineageVM,
  ChatAgentVM,
  ChatSubagentVM,
  ChatRunVM,
  ChatRunHistoryVM,
  AgentOptionVM,
  TicketOptionVM,
  ChatOptionVM,
} from './chatTickets/types';

export {
  buildTimeline,
  buildSettledTimeline,
  strandedReplyKey,
  streamingNode,
  attachmentsOf,
  formatDuration,
} from './timelineModel';
export type { TimelineNode, TimelineImage, BuildTimelineInput } from './timelineModel';
export { modelMoveOf, modelMoveLine, DEFAULT_MODEL_MOVE_LABELS } from './timelineModelMoves';
export type { ModelMove, ModelMoveLabels } from './timelineModelMoves';

export { EvermindConsole } from './evermind/EvermindConsole';
export type { EvermindConsoleProps } from './evermind/EvermindConsole';
export { DEFAULT_EVERMIND_LABELS } from './evermind/types';
export { createEvermindRestAdapter, groupAbsorbed, loadEvermindBuilds, planIsPaid, preferredEvermindBuild, publishedEvermindModels, resolveTeacherOptions } from './evermind/restAdapter';
// The console's write gate lives with the other host-safe rules, so the VS Code host shares it.
export { isManagerRole } from '@seanhogg/builderforce-brain-embedded';
export type {
  EvermindBuild,
  EvermindHostPowers,
  EvermindRequest,
  EvermindRestOptions,
  MemoryCompactRequest,
  PickedMemory,
  PlanTier,
  TeacherModelsPayload,
  TenantModelRow,
} from './evermind/restAdapter';
export { evermindLabelsFromBundle } from './evermind/labelBundle';
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
  EvermindHost,
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
  EvermindEvalPoint,
  EvermindCodingGateView,
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

// THE prompt area — one composer for every surface (web Brain, canvas, VS Code, Rovr):
// the shell, the text box, `+`, the `/` Work panel with the shared Status tab, and the
// trailing button. Hosts pass state, ports and copy.
export { BrainComposer } from './composer/BrainComposer';
export type { BrainComposerLabels, BrainComposerProps } from './composer/BrainComposer';
export type { ComposerAddMenuItem } from './composer/ComposerAddMenu';
export type { ComposerAttachment } from './composer/AttachmentChips';
export type { ComposerOptions } from './composer/composerOptions';
export { DEFAULT_COMPOSER_LABELS, composerLabels } from './composer/labels';
export type { ComposerLabels } from './composer/labels';
export { useChatMemorySwitch } from './composer/useChatMemorySwitch';
export type { QueuedTurns, QueuedItem, QueuedTurnsOptions } from './composer/useQueuedTurns';

// The `/` menu's Status tab — plan, meters, 30-day spend & savings, Evermind.
export { WorkStatusPanel } from './workStatus/WorkStatusPanel';
export type { WorkStatusPanelProps } from './workStatus/WorkStatusPanel';
export { WorkSpendPanel } from './workStatus/WorkSpendPanel';
export type { WorkSpendPanelProps } from './workStatus/WorkSpendPanel';
export type { UpgradeTarget } from './workStatus/AccountStatus';
export { DEFAULT_WORK_STATUS_LABELS, workStatusLabels } from './workStatus/labels';
export type { WorkStatusLabels } from './workStatus/labels';
export {
  cachedConsumptionSnapshot,
  fetchConsumptionSnapshot,
  invalidateConsumptionSnapshot,
  subscribeConsumptionSnapshot,
} from './workStatus/consumptionSnapshot';
export type { ConsumptionSnapshot, JsonRequest } from './workStatus/consumptionSnapshot';
export { useConsumptionSnapshot } from './workStatus/useConsumptionSnapshot';

// Spent vs saved — the chat's spend pill and the breakdown behind it.
export { SpendPill } from './spend/SpendPill';
export { SpendBreakdown } from './spend/SpendBreakdown';
export { DEFAULT_SPEND_LABELS, spendLabels } from './spend/labels';
export type { SpendLabels } from './spend/labels';
export { formatUsd, formatTokens } from './spend/format';

// The ONE catalog → labels contract: each shared component's `xxxLabelsFrom(lookup)`
// holds its key table + English defaults; a host supplies only a lookup over its catalog.
export { stringsFrom, bundleLookup } from './labelCatalog';
export type { LabelLookup, LabelValues } from './labelCatalog';
export { composerLabelsFrom } from './composer/labels';
export { promptOptionsLabelsFrom } from './promptOptions/types';
export { workStatusLabelsFrom } from './workStatus/labels';
export { spendLabelsFrom } from './spend/labels';
export { chatTicketsLabelsFrom } from './chatTickets/labelBundle';
export { chatHistoryLabelsFrom } from './surface/ChatHistory';
export { toolConfirmLabelsFrom } from './ToolConfirmBar';
export {
  brainComposerLabelsFrom,
  DEFAULT_MENTION_LABELS,
  DEFAULT_TICKET_TAG_LABELS,
} from './composer/brainComposerLabels';
export type { FullBrainComposerLabels } from './composer/brainComposerLabels';

// The `/` menu's Model section from a host's catalogue — empty fallback, on-device merge,
// pending entitlement and the pin → choice rule, once for every host.
export { composerModel, composerCatalogLoaded, withLocalModels, modelSelectionFrom } from './composer/composerModel';
export type { ComposerModelCatalog, ComposerModelInput } from './composer/composerModel';
