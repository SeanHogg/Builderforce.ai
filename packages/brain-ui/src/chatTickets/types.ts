/**
 * Shared types for the ChatTicketsPanel — the chat↔ticket surface rendered
 * identically on the web app and inside the VS Code webview. The panel is
 * presentational + self-managing; each host injects a {@link ChatTicketsAdapter}
 * (its own REST calls) and a {@link ChatTicketsLabels} bundle (its own i18n).
 */

/** The work-item kinds a chat can be tied to (planning spine + roadmap + spec + gap). */
export type TicketKind = 'portfolio' | 'objective' | 'initiative' | 'roadmap' | 'spec' | 'epic' | 'gap' | 'task';
export const TICKET_KINDS: TicketKind[] = ['task', 'epic', 'gap', 'objective', 'initiative', 'portfolio', 'roadmap', 'spec'];
/** Only these kinds are runnable (a real board ticket an agent can execute). */
export const RUNNABLE_KINDS: TicketKind[] = ['task', 'epic', 'gap'];

export type LinkType = 'linked' | 'created';

/** A chat↔ticket link with a live health summary. */
export interface TicketLinkVM {
  linkId: number;
  kind: TicketKind;
  ref: string;
  label: string;
  status: string;
  /**
   * 0–100 completion percentage for the linked work item.
   *
   * `progressPct === 100` is the authoritative completion signal: it is emitted
   * ONLY once the work item is fully complete (a leaf that is marked done, or a
   * container whose every child/target is done — i.e. `done === total`). It is
   * never reported before completion, and a value approaching 100 (e.g. 99) does
   * NOT mean done — only an exact 100 does. Health is derived live on every read,
   * so 100 is an idempotent terminal state (reported on every subsequent read),
   * not a one-shot event delivered exactly once.
   */
  progressPct: number;
  done: number;
  total: number;
  exists: boolean;
  linkType: LinkType;
}

/** A chat that references a ticket (a lineage row). */
export interface LineageVM {
  chatId: number;
  title: string;
  linkType: LinkType;
  isArchived: boolean;
}

/** An agent invited into the chat. */
export interface ChatAgentVM {
  id: string;
  agentRef: string;
  role: string;
}

/** A human participant of the chat (shared access / audience, migration 0288). */
export interface ChatMemberVM {
  id: number;
  userId: string | null;
  name: string;
  email: string;
  /** 'active' (joined) | 'pending' (email invite, not yet an account). */
  status: string;
}

/** A selectable agent from the tenant pool. */
export interface AgentOptionVM {
  ref: string;
  name: string;
  meta: string;
  kind: string;
}

/** A pickable ticket for the link form. */
export interface TicketOptionVM {
  ref: string;
  label: string;
}

/** Another chat, for the merge picker. */
export interface ChatOptionVM {
  id: number;
  title: string;
}

/**
 * Host-provided data access — the only coupling to a backend. The web app wires
 * this to its `brain.*` / `pmoApi` / `tasksApi` clients; the VS Code webview wires
 * it to its bearer-fetch REST client. Same panel, same endpoints, different host.
 */
export interface ChatTicketsAdapter {
  listTickets(chatId: number): Promise<TicketLinkVM[]>;
  linkTicket(chatId: number, input: { kind: TicketKind; ref: string; linkType: LinkType }): Promise<void>;
  unlinkTicket(chatId: number, kind: TicketKind, ref: string): Promise<void>;
  listTicketChats(kind: TicketKind, ref: string): Promise<LineageVM[]>;
  consolidate(targetChatId: number, sourceChatIds: number[]): Promise<void>;
  listAgents(chatId: number): Promise<ChatAgentVM[]>;
  inviteAgent(chatId: number, input: { agentRef: string; agentKind: string }): Promise<void>;
  removeAgent(chatId: number, assignmentId: string): Promise<void>;
  loadAgentPool(): Promise<AgentOptionVM[]>;
  /** Human participants of the chat (shared access, migration 0288). */
  listMembers(chatId: number): Promise<ChatMemberVM[]>;
  /** Invite a human by email; returns the resolution ('active' | 'pending'). */
  inviteMember(chatId: number, email: string): Promise<{ status: string }>;
  removeMember(chatId: number, memberId: number): Promise<void>;
  /** Server-side typeahead over ONE tier: up to N (ref,label) hits whose
   *  title/name/goal/key matches `query` (empty = newest first). Replaces the old
   *  "load EVERY ticket then filter in the DOM" — fast AND complete on a huge tenant. */
  searchTickets(kind: TicketKind, query: string, projectId: number | null): Promise<TicketOptionVM[]>;
  /** Tag an agent to execute a runnable (task/epic) ticket. Returns whether a run
   *  actually started + the agent's display name for the toast. */
  runTicket(kind: TicketKind, ref: string, agentRef: string): Promise<{ started: boolean; agentName: string }>;
}

/** Every visible string. Parametric ones are functions the host localizes. */
export interface ChatTicketsLabels {
  none: string;
  spawned: string;
  run: string;
  /** Open the linked work item / artifact (board card, OKR, spec) in its own view. */
  open: string;
  lineage: string;
  unlink: string;
  pickAgent: string;
  lineageTitle: string;
  lineageEmpty: string;
  merged: string;
  runNoAgent: string;
  runFailed: string;
  link: string;
  agents: string;
  merge: string;
  linkFailed: string;
  kindLabel: string;
  pickTicket: string;
  /** Placeholder for the ticket-picker search box. */
  searchTicket: string;
  /** Shown while a typeahead request is in flight. */
  searching: string;
  /** Shown when a search returns no tickets. */
  noMatches: string;
  /** Hint under a result list that hit the server cap — type to narrow. */
  refine: string;
  linkTypeLabel: string;
  linkTypeLinked: string;
  linkTypeCreated: string;
  linkAction: string;
  noAgents: string;
  removeAgent: string;
  inviteAgent: string;
  agentsHint: string;
  people: string;
  noPeople: string;
  invitePerson: string;
  invitePersonHint: string;
  removePerson: string;
  inviteSent: string;
  invitePending: string;
  visibilityShared: string;
  visibilityLocked: string;
  lockHint: string;
  mergeHint: string;
  mergeNoOthers: string;
  /** Title on the collapsed ticket header — click to reveal the ring grid. */
  showTickets: string;
  /** Title on the expanded ticket header — click to collapse the ring grid. */
  hideTickets: string;
  kind: Record<TicketKind, string>;
  ringAria: (label: string, pct: number) => string;
  /** N-linked-tickets count shown in the collapsible header. */
  ticketCount: (n: number) => string;
  /** Aria label for the collapsed header's overall-progress ring. */
  overallAria: (pct: number) => string;
  runStarted: (agent: string) => string;
  mergeAction: (n: number) => string;
  mergedN: (n: number) => string;
}

/** English defaults — the VS Code webview uses these; the web app overrides via next-intl. */
export const DEFAULT_CHAT_TICKETS_LABELS: ChatTicketsLabels = {
  none: 'No tickets linked yet.',
  spawned: 'spawned here',
  run: 'Run agent on ticket',
  open: 'Open',
  lineage: 'Chat lineage',
  unlink: 'Unlink',
  pickAgent: 'Run as agent…',
  lineageTitle: 'Chats for this ticket',
  lineageEmpty: 'No other chats reference this ticket.',
  merged: 'merged',
  runNoAgent: 'No agent could run this ticket — assign one first.',
  runFailed: 'Could not start the run.',
  link: 'Link ticket',
  agents: 'Agents',
  merge: 'Merge',
  linkFailed: 'Could not link — check the ticket exists.',
  kindLabel: 'Ticket type',
  pickTicket: 'Choose a ticket…',
  searchTicket: 'Search tickets…',
  searching: 'Searching…',
  noMatches: 'No matching tickets.',
  refine: 'Showing the top matches — type to narrow.',
  linkTypeLabel: 'Link type',
  linkTypeLinked: 'Linked',
  linkTypeCreated: 'Created from chat',
  linkAction: 'Link',
  noAgents: 'No agents in this chat yet.',
  removeAgent: 'Remove',
  inviteAgent: 'Invite an agent…',
  agentsHint: 'Type @ in the message box to tag an invited agent — it replies in the chat and can act on the team\'s work — or run it on a linked task/epic above.',
  people: 'People',
  noPeople: 'No people invited yet.',
  invitePerson: 'Invite by email…',
  invitePersonHint: 'Invite a teammate to view and collaborate on this chat.',
  removePerson: 'Remove',
  inviteSent: 'Invitation sent.',
  invitePending: 'Invite sent — they will join when they sign in.',
  visibilityShared: 'Shared',
  visibilityLocked: 'Locked',
  lockHint: 'Shared chats are visible to the whole team; lock to keep this chat to its members only.',
  mergeHint: 'Merge other chats into this one. Their messages, tickets and agents move here; the sources are archived.',
  mergeNoOthers: 'No other chats to merge.',
  showTickets: 'Show linked tickets',
  hideTickets: 'Hide linked tickets',
  kind: { task: 'Task', epic: 'Epic', gap: 'Gap', objective: 'Objective', initiative: 'Initiative', portfolio: 'Portfolio', roadmap: 'Roadmap', spec: 'Spec' },
  ringAria: (label, pct) => `${label}: ${pct}% done`,
  ticketCount: (n) => `${n} ticket${n === 1 ? '' : 's'}`,
  overallAria: (pct) => `Overall progress: ${pct}% done`,
  runStarted: (agent) => `Started ${agent} on the ticket.`,
  mergeAction: (n) => `Merge ${n} here`,
  mergedN: (n) => `Merged ${n} chat(s).`,
};
