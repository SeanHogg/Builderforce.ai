import type { ChatModeVocabulary } from '@/lib/brain/useChatModeCopy';
import type { ReactNode } from 'react';
import type { ChatModelOptions, ChatModelSelection, ModelIdentityContext } from '@seanhogg/builderforce-brain-ui';
import type { DirectedRecipient, TicketTag } from '@seanhogg/builderforce-brain-embedded';
import type { BrainEffort, ChatMode } from '@/lib/brain';

export interface ChatInputAttachment {
  key: string;
  name: string;
  type: string;
}

/** A host-supplied row in the composer's `+` menu, drawn after Upload and Add context. */
export interface ComposerAddMenuItem {
  id: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
}

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** Accessible name when it should differ from the visible placeholder. */
  ariaLabel?: string;
  disabled?: boolean;
  /** Send button label/title. */
  submitLabel?: string;
  /**
   * When true, a run is in flight: the Send button is replaced by a Stop button
   * that calls {@link onStop}. Requires `onStop` to render (otherwise the Send
   * button shows as before). Lets the user interrupt a streaming reply.
   */
  running?: boolean;
  /** Interrupt the in-flight run (shown as a Stop button while `running`). */
  onStop?: () => void;
  /**
   * Turns the user typed while a run was in flight and this composer is holding
   * (see `useQueuedTurns`). Rendered as a receipt under the input — the composer
   * owns this chrome so every host says the same sentence in the same place.
   * Zero renders nothing.
   */
  queuedCount?: number;
  /** Number of rows for the text area. Default 2. */
  rows?: number;
  /** If false, Enter does not submit (send only via button). Default true. */
  submitOnEnter?: boolean;
  /** Show + attach artifacts button and call onAttach when file selected. */
  onAttach?: (file: File) => void | Promise<void>;
  /**
   * When set, the `+` button becomes a Claude-style menu with an "Add context"
   * item that invokes this (e.g. attach a project/page reference). Needs `onAttach`
   * for the menu to render (Upload lives in the same menu).
   */
  onAddContext?: () => void;
  /** When set, the `+` menu shows a "Browse the web" toggle bound to this state. */
  webBrowsing?: boolean;
  onWebBrowsingChange?: (on: boolean) => void;
  /** When set, a `/` options menu exposes an Effort selector bound to this state. */
  effort?: BrainEffort;
  onEffortChange?: (effort: BrainEffort) => void;
  /** When set, the `/` options menu shows a "Thinking" toggle bound to this state. */
  thinking?: boolean;
  onThinkingChange?: (on: boolean) => void;
  /** When set, the `/` options menu shows an "Account settings" link to this href. */
  accountSettingsHref?: string;
  /** Model routing for the next turn, shown and changed in the `/` menu. A named
   *  model is sent as a strict pin. */
  modelSelection?: ChatModelSelection;
  modelOptions?: ChatModelOptions;
  onModelSelectionChange?: (selection: ChatModelSelection) => void;
  /** The model the gateway will actually use while the selection is `auto`, when
   *  the host knows it — so the menu names what is running, not just "Auto". */
  effectiveModel?: string;
  /** Who is reading: the routing product funding their turns, and whether the gateway
   *  would accept a pin from them. A viewer who may not pin is named by product rather
   *  than by upstream model, and the `/` menu says why instead of offering a dead list.
   *  Comes from `useModelIdentity()` — never re-derived per surface. */
  modelIdentity?: ModelIdentityContext;
  /**
   * Conversation mode for this turn — Chat (answer it) or Work (open it, staff it,
   * dispatch it). Shown and changed in the `/` menu, and named on its trigger: this
   * is the setting that decides whether a turn can leave real work behind, so it is
   * readable without opening anything but does not cost the action row a control.
   */
  chatMode?: ChatMode;
  onChatModeChange?: (mode: ChatMode) => void;
  /** Which words this surface uses for the modes (Ask / Build beside a project being built). */
  modeVocabulary?: ChatModeVocabulary;
  /** Persistent memory for this conversation, shown and changed in the `/` menu. */
  memoryEnabled?: boolean;
  onMemoryChange?: (on: boolean) => void;
  /** Why memory is unusable right now — the `/` menu states it rather than offering
   *  a toggle that would do nothing. */
  memoryUnavailableReason?: string;
  /**
   * Consolidate / fork THIS chat, shown in the `/` menu (never as pills in the
   * action row — they are inert for most of a chat's life and would crowd out Send
   * on a narrow panel). Needs both handlers to render.
   */
  canConsolidate?: boolean;
  consolidating?: boolean;
  forking?: boolean;
  onConsolidate?: () => void;
  onFork?: () => void;
  /** When set, the `/` options menu toggles auto-approval of tool actions. */
  autoMode?: boolean;
  onAutoModeChange?: (on: boolean) => void;
  /** Show brain storm (ideation) icon — link to /brainstorm or callback. */
  showBrainIcon?: boolean;
  /** Show voice (dictate) button. Uses browser Speech Recognition when available. */
  showVoice?: boolean;
  /** Pending attachments to display (e.g. before send). */
  pendingAttachments?: ChatInputAttachment[];
  onRemoveAttachment?: (key: string) => void;
  /** Optional content rendered right-aligned below the input row (e.g. agent-connection status). */
  secondaryContent?: ReactNode;
  /**
   * Invited chat participants (agents + humans). When non-empty the composer gets
   * an @-mention typeahead: typing `@` opens a picker; choosing one calls
   * {@link onMention} (wire to the recipient choice) and clears the `@query`.
   */
  mentionables?: DirectedRecipient[];
  /** Called when a participant is picked from the @-mention typeahead. */
  onMention?: (recipient: DirectedRecipient) => void;
  /**
   * Available tickets that can be #tagged. When non-empty the composer gets
   * a #tag typeahead: typing `#` opens a picker; choosing one calls
   * {@link onTicketTag} and clears the `#query`.
   */
  ticketables?: TicketTag[];
  /** Called when a ticket is picked from the #tag typeahead. */
  onTicketTag?: (ticket: TicketTag) => void;
  /** Who answers / what is addressed ("Acting as", capability, "To", scope) — the composer's context row. */
  contextControls?: ReactNode;
  /** Extra rows for the `+` menu — host actions that belong with "add to this turn". */
  addMenuItems?: readonly ComposerAddMenuItem[];
  /** Host-specific standing facts (e.g. the memory status) shown beside the plan chip in the last row. */
  meta?: ReactNode;
  /**
   * `compact` folds the composer to two rows — the text, then one tool row — for a
   * docked Brain (a workspace's, or the canvas's Brain panel): the context controls
   * join the tool row, the `/` trigger shows only the armed mode, and the
   * standing-facts row (plan chip, `meta`) is not rendered. Defaults to
   * `comfortable`, the four-row layout.
   */
  density?: 'comfortable' | 'compact';
  className?: string;
  /**
   * Change this to any new value to focus the composer and put the caret at the
   * end of the text. Used when something else seeds the composer (e.g. picking a
   * capability), so the seeded line reads as a sentence to finish rather than a
   * finished message to send.
   */
  focusToken?: number | string;
}
