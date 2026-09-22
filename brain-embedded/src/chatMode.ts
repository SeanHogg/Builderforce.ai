/**
 * Chat MODE — "am I being asked a question, or being asked to get something done?"
 *
 * Two modes, one per conversation:
 *
 *   • `chat` — CONVERSATIONAL. The Brain reads, reasons and answers. It may look
 *     anything up, but it does not mint board work, staff it, or start runs off
 *     its own back. This is the default and the surface's resting state.
 *
 *   • `work`  — EXECUTIONAL. The Brain turns what it concludes into real work: it
 *     creates the ticket, scopes the resources, links it to the conversation,
 *     advances its status, and DISPATCHES an agent to run it. The conversation is
 *     the front end of an execution, not a discussion about one.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * The work-linking directive ({@link chatWorkLinkingDirective}) used to ride EVERY
 * run unconditionally — so "what does this error mean?" was answered by a model that
 * had also been instructed to open, staff and status a ticket about it. There was no
 * way to just ask a question, and no way to tell an execution apart from a chat after
 * the fact. Mode is the discriminator for both: it gates the directive at runtime and
 * it is recorded on the conversation, so usage can finally be read as
 * "conversations vs executions" rather than one undifferentiated pile.
 *
 * The value is persisted on the conversation (`brain_chats.mode`, `creation_sessions.mode`,
 * migration 0409) rather than in the browser, so the choice follows the conversation
 * across surfaces and devices — the same reasoning as `capability` (0345).
 *
 * Kept framework-free (pure strings + unions) so it is safe in every bundle: the web
 * Brain, the VS Code webview, and the shared agent loop all import from here.
 */

import { chatWorkLinkingDirective } from './chatWorkLinking';

/** The modes a conversation can be in. Order is display order. */
export const CHAT_MODES = ['chat', 'work'] as const;

export type ChatMode = (typeof CHAT_MODES)[number];

/**
 * The mode a NEW conversation opens in.
 *
 * Work, because that is what people come here to do: the measured reality is that a
 * conversation which cannot dispatch produces a plan and stops, and the user is then
 * asked to find a control they did not know existed to get the work started. Opening
 * in Work makes the product's actual promise the resting state; a user who only wants
 * to ask a question flips one switch in the composer's `/` menu.
 *
 * This is NOT the coercion fallback — see {@link RESTING_CHAT_MODE}. The two were one
 * constant, which meant "what does a new chat start as" and "what does an unreadable
 * stored value mean" could not be answered differently, and changing one silently
 * re-armed every legacy row that had never stored a mode at all.
 */
export const NEW_CHAT_MODE: ChatMode = 'work';

/**
 * What an unset or unrecognised stored value resolves to: a conversation. A row that
 * never recorded a mode (or a client ahead of the server) must not be granted execution
 * authority by a default it never opted into.
 */
export const RESTING_CHAT_MODE: ChatMode = 'chat';

/**
 * The glyph for a mode. Decorative — the label always carries the meaning — but it
 * lives HERE, beside the mode vocabulary, because both composers render it: the web
 * `/` menu and the VS Code webview's `/` menu. A second copy in one host is how the
 * two surfaces end up showing a different icon for the same conversation state.
 */
export const CHAT_MODE_ICON: Readonly<Record<ChatMode, string>> = {
  chat: '💬',
  work: '⚡',
};

/** True for a value that is one of the known modes. */
export function isChatMode(value: unknown): value is ChatMode {
  return typeof value === 'string' && (CHAT_MODES as readonly string[]).includes(value);
}

/**
 * Coerce an inbound/stored value to a mode, falling back to {@link RESTING_CHAT_MODE}.
 * Tolerant by design: an unknown value (an older row, a client ahead of the server)
 * resolves to a conversation rather than silently granting execution authority.
 */
export function normalizeChatMode(value: unknown): ChatMode {
  return isChatMode(value) ? value : RESTING_CHAT_MODE;
}

/**
 * The system-prompt block for CHAT mode.
 *
 * Deliberately a positive instruction rather than only a prohibition: a model told
 * merely "do not create tickets" tends to hedge and offer to create one every turn,
 * which is the same interruption in a politer costume. This tells it what its job IS
 * — answer the question — and makes the ONE escape hatch explicit (the user asking
 * outright), so the mode is a default rather than a cage.
 */
export function chatConversationDirective(): string {
  return (
    'MODE: CHAT. This conversation is a conversation. Your job is to understand the question and answer it.\n' +
    '• Read, search, inspect and reason as much as the question needs — every read-only tool is available to you and using them is encouraged. Ground the answer in what you actually looked up.\n' +
    '• Do NOT create, staff, re-status, or dispatch board work as a side effect of answering. Identifying that something ought to be done is part of a good answer; opening a ticket about it is not.\n' +
    '• If the work plainly ought to be tracked, END the answer with one short line naming it and telling the user they can switch this conversation to Work mode to have it opened and run. Offer it once; do not repeat the offer on later turns.\n' +
    '• The single exception: if the user explicitly asks you to create, assign, schedule or run something in THIS message, do it. An explicit instruction outranks the mode.'
  );
}

/**
 * One agent invited into the chat, as the Work directive names it.
 *
 * Deliberately the three facts a dispatch decision needs and nothing else: the NAME the
 * human knows them by, the REF `chats.dispatch_agent` takes, and the ROLE that says
 * which work is theirs. Kept structural (no import from the chat-tickets view model) so
 * this module stays framework-free and every host can satisfy it from whatever it
 * already holds.
 */
export interface ChatRosterAgent {
  ref: string;
  name: string;
  role?: string;
}

/**
 * The agent half of a chat's addressable participants, as the Work directive wants it.
 *
 * Every host that renders a recipient picker or an @-mention typeahead already holds
 * the participant list (agents AND humans, each with a ref and a display name). Rather
 * than have each of them fetch the roster a SECOND time to tell the run about it — two
 * reads of one endpoint on every chat open — they derive it from what they have. One
 * mapping, here, so the agents the user can @-mention are exactly the agents the run is
 * told it may dispatch to.
 *
 * Typed structurally (`{ kind, ref, name }`) rather than against `DirectedRecipient` so
 * this module keeps its no-dependency posture; the shapes are checked by the call sites.
 */
export function chatRosterFromParticipants(
  participants: readonly { kind: string; ref: string; name: string }[] | undefined,
): ChatRosterAgent[] {
  return (participants ?? [])
    .filter((p) => p.kind === 'agent' && p.ref)
    .map((p) => ({ ref: p.ref, name: p.name || p.ref }));
}

/** What the Work directive needs to know about the surface and the chat it rides. */
export interface ChatWorkDirectiveOptions {
  /** Does this run hold the workspace file tools (see `./localWorkspaceTools`)? */
  canEditHere?: boolean;
  /** Does the catalog carry `spawn_agent`, so persona delegation may be named? */
  canDelegate?: boolean;
  /** The agents invited into this chat. Non-empty INVERTS the do-it-here ordering. */
  roster?: readonly ChatRosterAgent[];
}

/**
 * The roster as one readable clause: `Bob (ref d02ff7ee…, participant), John (…)`.
 *
 * Kept beside the directive rather than at a call site because both halves of the
 * prompt read it — the clause that introduces the agents and the clause that tells the
 * model to dispatch to them — and a roster rendered two ways is a roster the model can
 * read as two different teams.
 */
function describeRoster(roster: readonly ChatRosterAgent[]): string {
  return roster
    .map((a) => `${a.name} (agentRef ${a.ref}${a.role ? `, ${a.role}` : ''})`)
    .join('; ');
}

/**
 * The system-prompt block for WORK mode: the existing chat⇄work linking contract
 * PLUS the dispatch obligation that makes the mode mean execution rather than
 * paperwork.
 *
 * The dispatch half exists because creating a well-staffed ticket and stopping is
 * indistinguishable, from the user's side, from doing nothing: the measured reality
 * is that tickets opened and never dispatched sit in backlog indefinitely. So the
 * mode's closing obligation is to REPORT the dispatch verdict truthfully — `tasks.create`
 * and `tasks.update` already return `autoRun: { dispatched, reason, detail }`, and
 * `chats.dispatch_agent` starts a run directly when autonomy declined.
 *
 * ── WHY `canEditHere` EXISTS ───────────────────────────────────────────
 * "Finish by dispatching" is the right obligation on the web Brain, which has no file
 * tools and can only get code changed by asking someone else to change it. On the IDE
 * surface it is not: that session HAS the workspace, and read as an unconditional rule
 * it sends the agent to open a ticket and hire a remote builder for a one-line fix it
 * was already looking at — measured, on a small UI defect, as a whole turn spent
 * fighting a dispatch with the file untouched at the end of it.
 *
 * So the ordering is stated where the surface actually differs, driven by whether this
 * run was given code-change tools ({@link ./localWorkspaceTools}'s `CODE_CHANGE_TOOLS`,
 * which is the same set the "a code change is always tied to a ticket" backstop reads).
 * Doing the work still ends in a ticket — recording is not optional, it is just not a
 * substitute for doing.
 *
 * ── WHY `roster` OVERRIDES THAT ORDERING ─────────────────────────────────────────
 * `canEditHere` answers "could this session make the change", which is not the same
 * question as "whose change is it". A chat with agents INVITED INTO IT has already
 * answered the second one: a human opened the Agents panel and put Bob, John and the
 * Manager in this conversation, which is the platform's only way of saying "these are
 * the people I want on this work". Read without that fact, the do-it-here rule
 * quietly overrides the staffing the human just did — measured on chat #103, where
 * three invited agents watched an IDE session make every code change itself and the
 * run's staffing summary read `1 ticket filed · 0 dispatched`, with ZERO dispatch
 * attempts: the model never asked, because nothing had told it there was anyone to ask.
 *
 * Two things follow, and they are separate. First, the roster is NAMED in the prompt,
 * because "pick a capable agent" costs a discovery tool call that the do-it-here rule
 * gives the model no reason to spend — the agents were in the chat and invisible to the
 * run. Second, when the roster is non-empty the ordering INVERTS: the invited agents own
 * the work and this session dispatches to them. The do-it-here rule survives only for a
 * chat nobody has staffed, which is the case it was written for.
 *
 * Tool names here are the ADVERTISED (`builtin_*`) names the model actually sees on
 * the gateway relay — never the catalog ids, which appear nowhere in its tool list.
 * The roster is rendered as names AND refs because the model reads the name and
 * `builtin_chats_dispatch_agent` takes the ref.
 */
export function chatWorkDirective(chatId: number, opts?: ChatWorkDirectiveOptions): string {
  // Delegation is named ONLY where the surface actually advertises `spawn_agent`. A tool
  // the prompt names and the catalog does not carry is the "narrated but never advertised"
  // failure by construction: the model writes the call it was told to make, nothing
  // executes, and the run reads as a model fault. The web Brain has no sub-agent tool.
  const throughThem = opts?.canDelegate
    ? " When you do a slice of the work here instead of dispatching it, do it THROUGH one of them: spawn_agent with as_agent=<that agent's name> so the slice is done in that agent's persona, and say which agent did what. Work that names no agent is work nobody owns."
    : '';
  const roster = opts?.roster ?? [];
  const staffed = roster.length > 0;
  // The roster VERBATIM, so the model never spends a discovery call to learn who it may
  // dispatch to — and never has to guess a ref from a name. `dispatch_agent` takes the
  // ref; a human reads the name; both are here so neither has to be inferred.
  const whoIsHere = staffed
    ? `• THE AGENTS IN THIS CHAT are ${describeRoster(roster)}. A human put them here: that is this platform's way of saying these are the people this work belongs to.\n`
    : '';
  // Staffed ⇒ dispatch wins. Unstaffed ⇒ the do-it-here ordering, which was written for
  // exactly that case — a session holding the workspace with nobody else to ask.
  const ordering = staffed
    ? `• DISPATCH TO THEM. That is the DEFAULT in this chat, not a fallback. Work that falls inside one of their roles is THEIR work: assign the ticket and start the run with builtin_chats_dispatch_agent (chatId=${chatId}, agentRef=<the ref above>, taskId=<the ticket>), then say who picked it up. Do NOT make the change yourself merely because you could do it faster — the human staffed this conversation, and a session that quietly does its agents' work leaves them idle and leaves the user unable to see who did what.${opts?.canEditHere ? ' You DO hold the workspace file tools; keep them for what dispatch cannot cover — reading and locating the code so the directive you hand an agent is specific, checking what a run came back with, and an edit the user asks YOU for in this message.' : ''}\n`
    : opts?.canEditHere
      ? `• DO IT HERE WHEN YOU CAN. No agent has been invited into this chat, so there is nobody to hand it to. This session has the workspace file tools, so anything you could change yourself in a handful of tool calls — a bug fix, a small refactor, a CSS or copy change, anything you have already located in the code — you MAKE, now. Dispatching a cloud agent for work you are already holding costs a whole run to do less than you can, and leaves the user waiting for it. Then record the change against this chat. Dispatch is for work this session genuinely cannot do: a long-horizon or repetitive batch, or work that must run somewhere you are not.\n`
      : '';
  return (
    `MODE: WORK. This conversation exists to get something DONE, not to describe it. Take the work all the way to a finished change or a running agent.\n` +
    `${chatWorkLinkingDirective(chatId)}\n` +
    whoIsHere +
    ordering +
    `• FINISH BY DISPATCHING what you did not do yourself. A ticket that no agent is running has not started. Every create/update tool returns an \`autoRun\` verdict — read it. When \`autoRun.dispatched\` is true, say which agent picked the work up. When it is false, do not stop there: pick a capable agent (${staffed ? 'one of the agents above, or ' : ''}builtin_cloud_agents_list_mine, or builtin_tasks_assignees for the accountable roster) and start the run yourself with builtin_chats_dispatch_agent (chatId=${chatId}, agentRef=<the agent>, taskId=<the ticket>). A dispatched agent joins this chat and can be steered mid-run with builtin_executions_post_message.\n` +
    `• STAFF WITH THE TEAM. The workspace's agents (builtin_chats_list_agents for those already in this chat, builtin_cloud_agents_list_mine for all of them) are the people this work belongs to. When you file tickets, assign and dispatch the agent whose role fits each one — never leave a ticket with no agent on it.${throughThem}\n` +
    `• builtin_chats_runs (chatId=${chatId}) says what has ALREADY run on this chat's tickets and who started each run. Read it before claiming work is under way, and before starting a duplicate: an empty result means nothing was ever dispatched, whatever the transcript says about it.\n` +
    `• If dispatch is genuinely refused — no capable agent, an execution kill-switch, an exhausted run cap, a human gate on the lane, a lifecycle-managed stage with no bound role — the refusal names the reason and what would clear it. Report THAT reason, do not retry the same dispatch hoping for a different answer, and if the work is something you could do here, do it instead. Never imply work has begun when nothing was dispatched, and never describe a dispatch you did not make.`
  );
}

/**
 * The system-prompt block for a mode. This is the ONE place a mode becomes model-facing
 * behaviour, so the two surfaces (web Brain, VS Code webview) and the shared agent loop
 * cannot drift on what a mode means.
 */
export function chatModeDirective(mode: ChatMode, chatId: number, opts?: ChatWorkDirectiveOptions): string {
  return mode === 'work' ? chatWorkDirective(chatId, opts) : chatConversationDirective();
}
