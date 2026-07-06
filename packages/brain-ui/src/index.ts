/**
 * @seanhogg/builderforce-brain-ui — the shared React UI for the BuilderForce
 * Brain. The single source of truth for the chat transcript experience, rendered
 * identically on the web app and inside the VS Code webview.
 *
 * Import the stylesheet once per host: `@seanhogg/builderforce-brain-ui/styles.css`
 * and map the `--bf-*` theme variables to your host's tokens.
 */

export { BrainTimeline, DEFAULT_TIMELINE_LABELS } from './BrainTimeline';
export type { BrainTimelineProps, BrainTimelineLabels } from './BrainTimeline';

export { Markdown } from './Markdown';
export type { MarkdownProps, MarkdownLabels } from './Markdown';

export { QuestionCard, parseAskUser, stripAskUser, serializeAskUser, DEFAULT_ASK_USER_LABELS } from './askUser';
export type { AskUserPayload, AskUserOption, AskUserLabels } from './askUser';

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
export type {
  EvermindConsoleAdapter,
  EvermindConsoleLabels,
  EvermindConsoleData,
  EvermindMode,
  EvermindRecentEntry,
  EvermindSeedModel,
  EvermindTeacherOptions,
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
