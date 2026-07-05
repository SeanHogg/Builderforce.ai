import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainProvider,
  BrainActionsProvider,
  useRegisterBrainActions,
  useBrainActions,
  useBrainConversation,
  useBrainConfig,
  useMcpExtensions,
  consolidationMarkerContent,
  consolidationMetadata,
  mentionRecipient,
  resolveRecipient,
  type BrainConfig,
  type BrainChat,
  type DirectedRecipient,
  type RecipientChoice,
} from '@seanhogg/builderforce-brain-embedded';
import {
  BrainTimeline, ChatTicketsPanel, DEFAULT_CHAT_TICKETS_LABELS, Avatar, useChatParticipants,
  type BrainTimelineLabels,
} from '@seanhogg/builderforce-brain-ui';
import { createChatTicketsAdapter } from './chatTicketsAdapter';
import {
  getToken,
  getEditorContext,
  onInit,
  onIntent,
  onEditorContext,
  onTokenChange,
  post,
  request,
  refreshToken,
  type BrainIntent,
  type EditorContext,
  type InitData,
  type LabelBundle,
} from './vscodeBridge';
import { Project360Screen } from './Project360Screen';
import { ProjectPageScreen } from './ProjectPageScreen';
import { createPersistence } from './persistence';
import { buildHostTools } from './hostTools';
import { buildIdeSystemPrompt } from './systemPrompt';
import { activeProjectDirective, deltaVisibilityDirective, editorContextDirective } from '../../src/idePersona';
import { buildTranscript, hasTranscriptContent } from './transcript';

/** Read a localized string from the host's bundle, falling back to English. */
function makeT(labels: LabelBundle) {
  return (key: string, fallback: string): string => labels[key] ?? fallback;
}

/** The subset of the host bundle the shared <BrainTimeline> consumes. */
function timelineLabels(labels: LabelBundle): Partial<BrainTimelineLabels> {
  const t = makeT(labels);
  return {
    thinking: t('tl.thinking', 'Thinking…'),
    thoughtFor: t('tl.thoughtFor', 'Thought for {duration}'),
    you: t('tl.you', 'You'),
    assistant: t('tl.assistant', 'BuilderForce'),
    input: t('tl.input', 'Input'),
    output: t('tl.output', 'Output'),
    error: t('tl.error', 'Error'),
    loading: t('tl.loading', 'Loading…'),
    empty: t('tl.empty', 'Ask BuilderForce to build or change something.'),
    copy: t('tl.copy', 'Copy'),
    copied: t('tl.copied', 'Copied'),
    apply: t('tl.apply', 'Apply'),
    createFile: t('tl.createFile', 'Create file'),
    preview: t('tl.preview', 'Preview'),
  };
}

/** How hard the model should work on the next turn — surfaced in the `/` menu. */
type Effort = 'quick' | 'balanced' | 'thorough';

/**
 * Turn the composer's Effort / Thinking / Browse-the-web toggles into extra
 * system-prompt directives. These ride the SAME `extraSystem` channel the web
 * Brain uses, so a toggle actually changes how the next turn runs (no hidden
 * model params needed). 'balanced' is the neutral default and adds nothing.
 */
function buildComposerDirectives(o: { effort: Effort; thinking: boolean; web: boolean }): string {
  const parts: string[] = [];
  if (o.effort === 'quick')
    parts.push('Effort: favour a fast, concise, direct answer. Keep exploration minimal unless the task truly requires more.');
  if (o.effort === 'thorough')
    parts.push('Effort: apply maximum rigor. Be exhaustive, consider edge cases, verify your work, and do not stop until the task is fully complete.');
  if (o.thinking)
    parts.push('Reason step by step before answering: work the problem through and lay out your plan before you act.');
  if (o.web)
    parts.push('You may browse the web: when a question needs current or external information, use the `web.fetch` tool to read the relevant URL(s) rather than relying on memory, and cite the sources you use.');
  return parts.join('\n\n');
}

/* Toolbar glyphs — inline SVG so they render crisply in the editor's light AND
   dark themes (they inherit currentColor) with no icon-font dependency. */
const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.25v9.5M3.25 8h9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
);
const IconSlash = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.25 3 5.75 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);
const IconMic = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="6" y="2" width="4" height="7.5" rx="2" fill="currentColor" /><path d="M3.75 8a4.25 4.25 0 0 0 8.5 0M8 12.25V14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
);
const IconSend = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 13V3.75M4.25 7.5 8 3.75l3.75 3.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const IconBolt = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.2 1 3.4 8.6h3.4L6 15l6.2-8.1H8.6L9.2 1z" /></svg>
);
/* Consolidate = collapse the conversation inward into a compact summary. */
const IconConsolidate = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 5.5 4.5 8 2 10.5M14 5.5 11.5 8 14 10.5M6.5 3v10M9.5 3v10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
/* Fork = branch the conversation into a new one (git-branch glyph). */
const IconFork = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="4" cy="3.5" r="1.5" fill="currentColor" /><circle cx="4" cy="12.5" r="1.5" fill="currentColor" /><circle cx="12" cy="3.5" r="1.5" fill="currentColor" /><path d="M4 5v6M4 8h4.5A3.5 3.5 0 0 0 12 4.5V5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
/* Rename = pencil glyph for editing the selected chat's title. */
const IconRename = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.75 2.25 13.75 5.25 6 13H3v-3l7.75-7.75zM9.5 3.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/**
 * A small popover menu (the `+` and `/` composer affordances). Closes on outside
 * click or Escape. `children` is a render prop given a `close()` so an item can
 * dismiss the menu after acting. Shared by both composer menus (DRY).
 */
function PopoverMenu({
  trigger, title, align = 'left', triggerClassName, children,
}: {
  trigger: React.ReactNode;
  title: string;
  align?: 'left' | 'right';
  /** Override the trigger's class (defaults to the square icon button). */
  triggerClassName?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="bf-menu" ref={ref}>
      <button
        type="button"
        className={`${triggerClassName ?? 'bf-iconbtn'}${open ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        aria-label={title}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`bf-menu__pop bf-menu__pop--${align}`} role="menu">
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** One row in a {@link PopoverMenu}. `active` shows a trailing check. */
function MenuItem({ icon, label, hint, active, onClick }: {
  icon: React.ReactNode; label: string; hint?: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" className={`bf-menu__item${active ? ' is-active' : ''}`} onClick={onClick}>
      <span className="bf-menu__ico" aria-hidden="true">{icon}</span>
      <span className="bf-menu__lbl">{label}</span>
      {hint != null && <span className="bf-menu__hint">{hint}</span>}
      <span className="bf-menu__check" aria-hidden="true">{active ? '✓' : ''}</span>
    </button>
  );
}

/** Root: wait for the host's init frame, then mount the brain providers. */
export function App() {
  const [init, setInit] = useState<InitData | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const offInit = onInit(setInit);
    const offToken = onTokenChange(() => force((n) => n + 1));
    return () => { offInit(); offToken(); };
  }, []);

  if (!init) {
    return <div className="bf-center">Connecting…</div>;
  }
  const t = makeT(init.labels);
  if (!init.signedIn || !getToken()) {
    return (
      <div className="bf-center">
        <p>{t('app.signInPrompt', 'Sign in to BuilderForce to start.')}</p>
        <button className="bf-btn bf-btn--primary" onClick={() => post('signin')}>
          {t('app.signIn', 'Sign in')}
        </button>
      </div>
    );
  }
  // Multi-screen: the host picks which surface this webview renders via `init.view`
  // (same bundle, same transport). Project 360 + the list pages are standalone
  // screens — no Brain providers needed, they fetch their data directly like the
  // chat fetches /api/brain.
  if (init.view === 'project360') return <Project360Screen init={init} />;
  if (init.view === 'backlog' || init.view === 'prd' || init.view === 'roadmap' || init.view === 'retros' || init.view === 'poker')
    return <ProjectPageScreen init={init} view={init.view} />;
  return <ConfiguredApp init={init} />;
}

function ConfiguredApp({ init }: { init: InitData }) {
  const config = useMemo<BrainConfig>(
    () => ({
      transport: {
        baseUrl: init.baseUrl,
        getToken,
        onUnauthorized: () => void refreshToken(),
        defaultModel: init.model,
      },
      persistence: createPersistence(init.baseUrl, getToken, () => void refreshToken()),
      resolveSystemPrompt: () => buildIdeSystemPrompt({ hasWorkspace: init.hasWorkspace, grounding: init.grounding }),
    }),
    [init.baseUrl, init.model, init.hasWorkspace, init.grounding],
  );

  return (
    <BrainProvider config={config}>
      <BrainActionsProvider>
        <ToolRegistrar tools={init.tools} />
        <PlatformTools />
        <Chat init={init} />
      </BrainActionsProvider>
    </BrainProvider>
  );
}

/** Registers the host's file tools so the model can call them over the bridge. */
function ToolRegistrar({ tools }: { tools: InitData['tools'] }) {
  const actions = useMemo(() => buildHostTools(tools), [tools]);
  useRegisterBrainActions(actions);
  return null;
}

/**
 * Registers the SHARED gateway MCP catalog (projects/tasks/OKRs/specs/…) — the
 * exact same server-side tool list the web Brain consumes via this hook, fetched
 * directly from the gateway (the webview reaches it over HTTPS; CORS allows the
 * `vscode-webview://` origin). So the IDE Brain can manage work items, not just
 * edit local files: one brain, one tool catalog. On any write we nudge the host so
 * its Project & Tasks tree refreshes live.
 */
function PlatformTools() {
  useMcpExtensions({
    onToolResult: (info) => {
      if (info.mutating && info.ok) {
        post('platform.write', { name: info.name });
        // Let in-webview views (e.g. the chat↔ticket panel) refresh live after a
        // Brain-driven MCP write, mirroring the web app's brain-data event bus.
        window.dispatchEvent(new CustomEvent('bf:mcp-write', { detail: { name: info.name } }));
      }
    },
  });
  return null;
}

function Chat({ init }: { init: InitData }) {
  const t = makeT(init.labels);
  const { persistence } = useBrainConfig();
  const { toolSpecs, runTool, isMutating } = useBrainActions();
  const [chatId, setChatId] = useState<number | null>(null);
  const [chats, setChats] = useState<BrainChat[]>([]);
  // Inline rename of the selected chat: the header select swaps to a text field
  // (VS Code webviews block window.prompt, so editing is inline — the same pattern
  // the web Brain's history list uses). Commits via persistence.updateChat.
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  // Auto-approve skips the per-action confirm prompt. It's read through a REF (not
  // captured state) so `needsConfirm` stays referentially stable AND the value is
  // live: a run's tool loop captures `needsConfirm` at run start, so a plain state
  // read would keep prompting for the rest of an in-flight run even after the user
  // ticks "auto-approve" (the reported "checked it but got 3 prompts" bug). The ref
  // is the single source of truth; `autoApprove` state only drives the toggle UI.
  // Mirrors the web BrainPanel's approach so both surfaces behave identically.
  const [autoApprove, setAutoApprove] = useState(false);
  const autoApproveRef = useRef(false);
  const setAutoApproveMode = useCallback((on: boolean) => {
    autoApproveRef.current = on;
    setAutoApprove(on);
  }, []);
  const [input, setInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  // Stable reference so a keystroke (which re-renders this component) does not hand
  // <BrainTimeline> a fresh `labels` object and defeat its React.memo — otherwise the
  // whole transcript (and every message's markdown) re-parses on every character typed.
  const tlLabels = useMemo(() => timelineLabels(init.labels), [init.labels]);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  // Consolidate (summarize into a compact base context) / Fork (branch into a new
  // chat from that summary) are async, so guard against double-clicks while in flight.
  const [consolidating, setConsolidating] = useState(false);
  const [forking, setForking] = useState(false);
  // Composer run-shaping toggles (the `/` menu + the `+` menu's web option).
  // They compile into `extraSystem` directives, so a toggle changes how the next
  // turn actually runs. 'balanced' is the neutral default.
  const [effort, setEffort] = useState<Effort>('balanced');
  const [thinking, setThinking] = useState(false);
  const [webBrowsing, setWebBrowsing] = useState(false);
  // Speech-to-text (dictation) via the Web Speech API. Capability-gated: the mic
  // button only renders where the runtime exposes SpeechRecognition, so it is
  // never a dead control (see the gap register re: a universal transcription path).
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const speechSupported = typeof window !== 'undefined'
    && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  // Scope the conversation dropdown to the sidebar's active project so its list
  // MATCHES the Sessions tree (which filters by project). With no project selected
  // both show every chat. Server-side filter via ?projectId (same rows the sidebar
  // filters client-side). Re-runs when the project switches (init.project?.id dep).
  const reloadChats = useCallback(() => {
    const projectId = init.project?.id != null ? String(init.project.id) : undefined;
    persistence.listChats({ limit: 50, projectId })
      .then((list) => { setChats(list); post('chats.changed'); })
      .catch(() => {});
  }, [persistence, init.project?.id]);
  useEffect(() => { reloadChats(); }, [reloadChats]);

  // The open chat may not be in the project-filtered list — e.g. it belongs to
  // another project, or was just created for a task scoped elsewhere. Fetch it so
  // the dropdown still shows + keeps it selected instead of going blank.
  const [orphanChat, setOrphanChat] = useState<BrainChat | null>(null);
  useEffect(() => {
    if (chatId == null || chats.some((c) => c.id === chatId)) { setOrphanChat(null); return; }
    let cancelled = false;
    persistence.getChat(chatId).then((c) => { if (!cancelled) setOrphanChat(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [chatId, chats, persistence]);
  // The dropdown's rows: the project-scoped list, plus the open cross-project chat.
  const chatOptions = useMemo(
    () => (orphanChat && orphanChat.id === chatId ? [orphanChat, ...chats] : chats),
    [orphanChat, chatId, chats],
  );

  const needsConfirm = useCallback(
    (req: { name: string; args: unknown }) => !autoApproveRef.current && isMutating(req.name, req.args),
    [isMutating],
  );

  // Scope new chats to the sidebar's active project (same as task-seeded chats),
  // so a conversation is associated with the project it's about server-side.
  const ensureChatId = useCallback(async () => {
    if (chatId != null) return chatId;
    const chat = await persistence.createChat({ title: t('app.newChat', 'New chat'), projectId: init.project?.id ?? null });
    setChatId(chat.id);
    reloadChats();
    return chat.id;
  }, [chatId, persistence, reloadChats, t, init.project?.id]);

  // Ambient project context — the SAME `extraSystem` channel the web Brain uses to
  // tell the model the current project, so platform tools (repos.*/tasks.*/…)
  // default to it instead of asking for a projectId. Updates on project switch.
  const projectDirective = useMemo(
    () => [activeProjectDirective(init.project), deltaVisibilityDirective()]
      .filter(Boolean)
      .join('\n\n'),
    [init.project?.id, init.project?.name],
  );

  // Live editor context (active file / selection / open tabs), pushed by the host as
  // the user navigates, so the agent always knows what file is open and can resolve
  // "this file" / "the selection" without guessing a path. Seeded from init.
  const [editorCtx, setEditorCtx] = useState<EditorContext | undefined>(getEditorContext);
  useEffect(() => onEditorContext(setEditorCtx), []);
  const editorDirective = useMemo(() => editorContextDirective(editorCtx) ?? '', [editorCtx]);

  // Fold the composer toggles (effort / thinking / web) and the live editor context
  // into the same system channel as the project context, so the next turn honors them.
  const extraSystem = useMemo(
    () => [projectDirective, editorDirective, buildComposerDirectives({ effort, thinking, web: webBrowsing })]
      .filter(Boolean)
      .join('\n\n'),
    [projectDirective, editorDirective, effort, thinking, webBrowsing],
  );

  const conv = useBrainConversation({
    chatId,
    modality: 'ide',
    model: init.model,
    extraSystem,
    toolSpecs,
    runTool,
    needsConfirm,
    ensureChatId,
    onActivity: reloadChats,
  });

  // Chat↔ticket panel data adapter — same gateway endpoints as the web app's
  // panel, over the webview's bearer fetch (see chatTicketsAdapter).
  const ticketAdapter = useMemo(
    () => createChatTicketsAdapter(init.baseUrl, getToken, () => void refreshToken()),
    [init.baseUrl],
  );
  // Stable references so a keystroke / streaming token doesn't hand the memoized
  // <ChatTicketsPanel> fresh props and force its whole subtree to re-render.
  const ticketChatList = useMemo(() => chats.map((c) => ({ id: c.id, title: c.title })), [chats]);
  const onTicketsChanged = useCallback(() => { reloadChats(); conv.reloadMessages(); }, [reloadChats, conv.reloadMessages]);
  // Bumped when the Brain mutates work items via MCP tools, so the ticket panel
  // refreshes live (rings/links) rather than only on its own button actions.
  const [ticketRefresh, setTicketRefresh] = useState(0);

  // Auto-link the work item that opened this chat (a task/epic/gap from the tree or
  // board, a roadmap/spec row from a project page) so the chat is tied to it and the
  // ticket panel shows it — the missing half of "open the item in a chat". Bumps the
  // refresh signal so the just-mounted panel re-fetches and renders the new link.
  const linkOpenedTicket = useCallback(
    async (linkChatId: number, ticket: { kind: string; ref: string }) => {
      try {
        await ticketAdapter.linkTicket(linkChatId, { kind: ticket.kind as never, ref: ticket.ref, linkType: 'linked' });
        setTicketRefresh((n) => n + 1);
      } catch { /* linking is best-effort — a failed link never blocks the chat */ }
    },
    [ticketAdapter],
  );

  // Host-driven intents: the Sessions sidebar / task + project-page commands drive
  // this singleton panel (open a fresh chat, focus an existing one, or open a chat
  // scoped + linked to a work item).
  useEffect(() => {
    return onIntent((intent: BrainIntent) => {
      if (intent.kind === 'new') {
        setChatId(null);
        setInput('');
      } else if (intent.kind === 'seed') {
        if (intent.ticket) {
          // A project-page row (roadmap/spec/…): create the chat eagerly, seed the
          // prompt, and link the item — the panel then shows the linked ticket.
          const ticket = intent.ticket;
          const seedTitle = (ticket.title ?? intent.text ?? t('app.newChat', 'New chat')).slice(0, 60);
          persistence
            .createChat({ title: seedTitle, projectId: ticket.projectId ?? init.project?.id ?? null })
            .then((chat) => {
              setChatId(chat.id);
              setInput(intent.text ?? '');
              reloadChats();
              void linkOpenedTicket(chat.id, ticket);
            })
            .catch(() => {});
        } else {
          // Ticket-less editor entry point (review PRs / fix errors / open a PR): open a
          // fresh chat with the prompt pre-filled; the user can tweak before sending.
          setChatId(null);
          setInput(intent.text ?? '');
        }
      } else if (intent.kind === 'focus' && intent.chatId != null) {
        setChatId(intent.chatId);
      } else if (intent.kind === 'task' && intent.task) {
        const task = intent.task;
        const title = `${task.key ? `${task.key} ` : ''}${task.title}`.slice(0, 60);
        persistence
          .createChat({ title, projectId: task.projectId ?? null })
          .then((chat) => {
            setChatId(chat.id);
            const taskLabel = `${task.key ? `${task.key}: ` : ''}${task.title}`;
            const template = task.dispatched
              ? t('app.taskSeedDispatched', "I just dispatched {task} to run on the platform. Check the latest execution's status and trace, then help me follow up.")
              : t('app.taskSeed', "Let's work on {task}.");
            setInput(template.replace('{task}', taskLabel));
            reloadChats();
            // Link the task/epic/gap it was opened for (a host-supplied ticket wins;
            // else derive the kind from the task's own type).
            const ticket = intent.ticket
              ?? { kind: task.taskType === 'epic' ? 'epic' : task.taskType === 'gap' ? 'gap' : 'task', ref: String(task.id) };
            void linkOpenedTicket(chat.id, ticket);
          })
          .catch(() => {});
      }
    });
  }, [persistence, reloadChats, t, linkOpenedTicket, init.project?.id]);
  useEffect(() => {
    const h = () => setTicketRefresh((n) => n + 1);
    window.addEventListener('bf:mcp-write', h);
    return () => window.removeEventListener('bf:mcp-write', h);
  }, []);

  // Multi-party chat: who a message goes to. The BRAIN (default) executes; an
  // invited agent/human is just talked to. The selector only appears once a chat
  // actually has participants, so a solo chat is unchanged (everything → BRAIN).
  const participants = useChatParticipants(ticketAdapter, chatId, ticketRefresh);
  const [recipientChoice, setRecipientChoice] = useState<RecipientChoice>(null);
  // Reset to auto when switching chats; drop an explicit pick that's since left.
  useEffect(() => { setRecipientChoice(null); }, [chatId]);
  useEffect(() => {
    setRecipientChoice((c) => (c && c !== 'brain' && !participants.some((p) => p.ref === c.ref) ? null : c));
  }, [participants]);
  const mentioned = useMemo(() => mentionRecipient(input, participants), [input, participants]);
  // The effective target: an explicit BRAIN pick wins; else an explicit
  // participant; else a leading @mention; else the BRAIN (null).
  const recipient: DirectedRecipient | null = resolveRecipient(recipientChoice, mentioned);

  // Feed the project's Evermind: when a run finishes (sending true→false) with
  // content, hand the host this exchange so it can contribute what was learned back
  // to the shared model — the same loop cloud/on-prem run. The host gates it behind
  // the `builderforce.evermindLearning` setting + throttles, so this is a cheap
  // best-effort signal (not every frame).
  const prevSending = useRef(false);
  useEffect(() => {
    if (prevSending.current && !conv.sending
      && hasTranscriptContent({ messages: conv.messages, trace: conv.trace, error: conv.error })) {
      post('run.complete', {
        text: buildTranscript({
          messages: conv.messages,
          trace: conv.trace,
          assistantName: 'BuilderForce',
          model: init.model,
          error: conv.error,
        }),
        // The run's initiating user message (the "ticket") so the project-Evermind
        // teacher distils (task → answer), matching cloud + on-prem.
        prompt: conv.messages.find((m) => m.role === 'user')?.content ?? '',
      });
    }
    prevSending.current = conv.sending;
  }, [conv.sending, conv.messages, conv.trace, conv.error, init.model]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    for (const f of Array.from(files)) void conv.attach(f);
  }, [conv]);

  // "Add context" — ask the host to pick a workspace file (or the active editor
  // selection); it returns the path + text, which we attach through the SAME
  // upload pipeline as a dropped/uploaded file, so the model gets the content.
  const addContext = useCallback(async () => {
    try {
      const ctx = await request<{ path: string; text: string } | null>('context.pick');
      if (!ctx || !ctx.text) return;
      await conv.attach(new File([ctx.text], ctx.path || 'context.txt', { type: 'text/plain' }));
    } catch {
      /* host cancelled / no workspace — nothing to attach */
    }
  }, [conv]);

  // Dictation: stream interim + final transcripts into the composer, appended to
  // whatever the user had already typed. Stopping (button or end-of-speech)
  // clears the ref so the next click starts a fresh recognition.
  const toggleMic = useCallback(() => {
    const SR = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SR) return;
    if (recognitionRef.current) { recognitionRef.current.stop(); return; }
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    const base = input.trim() ? `${input.replace(/\s*$/, '')} ` : '';
    rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setInput(base + text);
    };
    const done = () => { setListening(false); recognitionRef.current = null; };
    rec.onend = done;
    rec.onerror = done;
    recognitionRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { done(); }
  }, [input]);

  // Stop any in-flight recognition if the panel unmounts.
  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { /* noop */ } }, []);

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length) { e.preventDefault(); attachFiles(imgs); }
  }, [attachFiles]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || conv.sending) return;
    setInput('');
    // Restore the typed text if the send fails before it's persisted (e.g. the
    // token expired) so the user's message is never silently lost — they can
    // just hit Send again once reconnected. Guard against clobbering anything
    // they've started typing in the meantime. `addressedTo` routes the turn: a
    // participant is talked to (no BRAIN run); null (the default) runs the BRAIN.
    void conv.send(text, { addressedTo: recipient }).then((ok) => { if (!ok) setInput((cur) => cur || text); });
  }, [input, conv, recipient]);

  // An expired/invalid session surfaces as a 401 whose body mentions the token.
  // We offer an explicit "Reconnect" affordance for it (re-exchange the token),
  // on top of the always-available dismiss.
  const isAuthError = /invalid or expired token|unauthor/i.test(conv.error);
  const reconnect = useCallback(() => {
    void refreshToken();
    conv.clearError();
  }, [conv]);

  // Triage helpers: copy the full transcript (turns + tool I/O + errors) so a
  // "No response" turn can be shared with its underlying system output, and run
  // the host's connection diagnostics. The host owns the clipboard + the
  // `builderforce.diagnose` command, reached over the bridge.
  // The project this chat is associated with: an existing chat's own project,
  // else (for a not-yet-created chat) the sidebar's active project it will be
  // scoped to on first send. Names resolve from the host's `projectId → name`
  // map, falling back to the active project's name.
  const activeChat = useMemo(() => chatOptions.find((c) => c.id === chatId) ?? null, [chatOptions, chatId]);
  const associatedProjectId = activeChat ? activeChat.projectId : (init.project?.id ?? null);
  const associatedProject = useMemo<{ id: number; name: string } | null>(() => {
    if (associatedProjectId == null) return null;
    const name = init.projectNames?.[String(associatedProjectId)]
      ?? (associatedProjectId === init.project?.id ? init.project?.name : undefined);
    return { id: associatedProjectId, name: name ?? `#${associatedProjectId}` };
  }, [associatedProjectId, init.projectNames, init.project?.id, init.project?.name]);

  const canCopy = hasTranscriptContent({ messages: conv.messages, trace: conv.trace, error: conv.error });
  const copyTranscript = useCallback(() => {
    post('copy', {
      text: buildTranscript({
        messages: conv.messages,
        trace: conv.trace,
        assistantName: 'BuilderForce',
        model: init.model,
        error: conv.error,
        project: associatedProject,
        chatTitle: activeChat?.title,
        chatId,
      }),
    });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [conv.messages, conv.trace, conv.error, init.model, associatedProject, activeChat?.title, chatId]);

  // Consolidate: summarize the whole chat into ONE compact assistant message tagged
  // as a consolidation marker. It's shown back to the user (the "flag"), and the
  // conversation loop seeds the next turn FROM this marker — so a long chat sends
  // its summary as the base context instead of the full (large) history.
  const canConsolidate = chatId != null && conv.messages.length >= 2 && !conv.sending;
  const consolidate = useCallback(async () => {
    if (chatId == null || consolidating) return;
    setConsolidating(true);
    conv.clearError();
    try {
      const result = await persistence.summarizeChat(chatId);
      if ('error' in result || !result.summary) {
        conv.setError(('error' in result && result.error) || t('app.nothingToConsolidate', 'Not enough conversation to consolidate yet.'));
        return;
      }
      await persistence.sendMessages(chatId, [{
        role: 'assistant',
        content: consolidationMarkerContent(result.summary),
        metadata: consolidationMetadata(),
      }]);
      conv.reloadMessages();
      reloadChats();
    } catch (e) {
      conv.setError(e instanceof Error ? e.message : 'Consolidate failed');
    } finally {
      setConsolidating(false);
    }
  }, [chatId, consolidating, persistence, conv, reloadChats, t]);

  // Fork: summarize this chat, then create a NEW chat (same project) seeded with
  // that summary as its consolidation marker, and switch to it — continue a fresh,
  // compact conversation without carrying the whole history.
  const fork = useCallback(async () => {
    if (chatId == null || forking) return;
    setForking(true);
    conv.clearError();
    try {
      const result = await persistence.summarizeChat(chatId);
      if ('error' in result || !result.summary) {
        conv.setError(('error' in result && result.error) || t('app.nothingToFork', 'Not enough conversation to fork yet.'));
        return;
      }
      const sourceTitle = activeChat?.title || t('app.newChat', 'New chat');
      const projectId = activeChat?.projectId ?? init.project?.id ?? null;
      const forkTitle = t('app.forkTitle', 'Fork of {title}').replace('{title}', sourceTitle).slice(0, 80);
      const chat = await persistence.createChat({ title: forkTitle, projectId });
      await persistence.sendMessages(chat.id, [{
        role: 'assistant',
        content: consolidationMarkerContent(result.summary),
        metadata: consolidationMetadata(),
      }]);
      setChatId(chat.id);
      reloadChats();
    } catch (e) {
      conv.setError(e instanceof Error ? e.message : 'Fork failed');
    } finally {
      setForking(false);
    }
  }, [chatId, forking, persistence, conv, reloadChats, activeChat?.title, activeChat?.projectId, init.project?.id, t]);

  // Begin editing the selected chat's title (only a real, saved chat can be renamed).
  const startRename = useCallback(() => {
    if (chatId == null) return;
    setRenameValue(activeChat?.title ?? '');
    setRenaming(true);
  }, [chatId, activeChat?.title]);

  // Commit the rename: PATCH the title, then refresh the list so the select + the
  // header reflect it. A blank/unchanged title just cancels (no needless write).
  const commitRename = useCallback(async () => {
    const title = renameValue.trim();
    setRenaming(false);
    if (chatId == null || !title || title === activeChat?.title) return;
    try {
      await persistence.updateChat(chatId, { title });
      reloadChats();
    } catch (e) {
      conv.setError(e instanceof Error ? e.message : 'Rename failed');
    }
  }, [chatId, renameValue, activeChat?.title, persistence, reloadChats, conv]);

  return (
    <div className="bf-app">
      <header className="bf-header">
        {/* The chat's associated project names the panel (falling back to the brand
            when a chat has no project), so it's clear which project this chat is about. */}
        <span className="bf-header__title" title={associatedProject ? associatedProject.name : 'BuilderForce'}>
          {associatedProject ? associatedProject.name : 'BuilderForce'}
        </span>
        {associatedProject
          ? <span className="bf-header__brand">BuilderForce</span>
          : <span className="bf-header__beta">{t('app.beta', 'beta')}</span>}
        <div className="bf-header__spacer" />
        {renaming ? (
          <input
            className="bf-select bf-rename-input"
            autoFocus
            value={renameValue}
            placeholder={t('app.renamePlaceholder', 'Chat name')}
            aria-label={t('app.rename', 'Rename chat')}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
              else if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
            }}
          />
        ) : (
          <select
            className="bf-select"
            value={chatId ?? ''}
            onChange={(e) => setChatId(e.target.value ? Number(e.target.value) : null)}
            aria-label={t('app.conversation', 'Conversation')}
          >
            <option value="">{t('app.newChat', 'New chat')}</option>
            {chatOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.title || `Chat ${c.id}`}</option>
            ))}
          </select>
        )}
        {/* Rename the selected chat — only enabled once a real chat is saved (a
            not-yet-created "New chat" has no server row to PATCH). */}
        <button
          className="bf-btn bf-btn--icon"
          title={t('app.rename', 'Rename chat')}
          aria-label={t('app.rename', 'Rename chat')}
          disabled={chatId == null || renaming}
          onClick={startRename}
        >
          <IconRename />
        </button>
        <button className="bf-btn" title={t('app.newChat', 'New chat')} onClick={() => setChatId(null)}>＋</button>
        <button
          className="bf-btn bf-btn--icon"
          title={t('app.copyChat', 'Copy chat transcript (for triage)')}
          aria-label={t('app.copyChat', 'Copy chat transcript (for triage)')}
          disabled={!canCopy}
          onClick={copyTranscript}
        >
          {copied ? '✓' : '⧉'}
        </button>
        <button
          className="bf-btn bf-btn--icon"
          title={t('app.diagnostics', 'Run connection diagnostics')}
          aria-label={t('app.diagnostics', 'Run connection diagnostics')}
          onClick={() => post('diagnose')}
        >
          🩺
        </button>
      </header>

      {chatId != null && (
        <div style={{ padding: '0 12px' }}>
          <ChatTicketsPanel
            chatId={chatId}
            projectId={init.project?.id ?? null}
            chatList={ticketChatList}
            adapter={ticketAdapter}
            labels={DEFAULT_CHAT_TICKETS_LABELS}
            onChanged={onTicketsChanged}
            refreshSignal={ticketRefresh}
          />
        </div>
      )}

      <div className="bf-body">
        <BrainTimeline
          messages={conv.messages}
          trace={conv.trace}
          streamingText={conv.sending ? conv.streamingText : ''}
          isRunning={conv.sending}
          loading={conv.loadingMessages}
          assistantName="BuilderForce"
          labels={tlLabels}
        />
      </div>

      {conv.error && (
        <div className="bf-error" role="alert">
          <span className="bf-error__msg">{conv.error}</span>
          <div className="bf-error__actions">
            {isAuthError && (
              <button className="bf-btn bf-btn--primary" onClick={reconnect}>
                {t('app.reconnect', 'Reconnect')}
              </button>
            )}
            <button
              className="bf-btn bf-btn--icon"
              onClick={conv.clearError}
              title={t('app.dismiss', 'Dismiss')}
              aria-label={t('app.dismiss', 'Dismiss')}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {conv.pendingConfirm && (
        <div className="bf-confirm">
          <span>
            {t('app.confirmRun', 'Run {name}?').split('{name}')[0]}
            <code>{conv.pendingConfirm.name}</code>
            {t('app.confirmRun', 'Run {name}?').split('{name}')[1] ?? ''}
          </span>
          {/* For run_command, show the exact command line so the user approves what
              actually runs, not just the tool name. */}
          {conv.pendingConfirm.name === 'run_command'
            && typeof (conv.pendingConfirm.args as { command?: unknown })?.command === 'string' && (
            <pre className="bf-confirm__cmd">{(conv.pendingConfirm.args as { command: string }).command}</pre>
          )}
          <div className="bf-confirm__actions">
            <button className="bf-btn bf-btn--primary" onClick={() => conv.resolveConfirm(true)}>{t('app.approve', 'Approve')}</button>
            <button className="bf-btn" onClick={() => conv.resolveConfirm(false)}>{t('app.cancel', 'Cancel')}</button>
            <label className="bf-confirm__auto">
              <input type="checkbox" checked={autoApprove} onChange={(e) => { setAutoApproveMode(e.target.checked); if (e.target.checked) conv.resolveConfirm(true); }} />
              {t('app.always', 'Always')}
            </label>
          </div>
        </div>
      )}

      <div
        className={`bf-composer${dragOver ? ' bf-composer--drag' : ''}${(inputFocused || input.trim().length > 0) ? ' bf-composer--active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); attachFiles(e.dataTransfer.files); }}
      >
        {conv.pendingAttachments.length > 0 && (
          <div className="bf-attachments">
            {conv.pendingAttachments.map((a) => (
              <span key={a.key} className="bf-chip">
                {a.imageUrl && <img src={a.imageUrl} alt="" className="bf-chip__thumb" />}
                <span className="bf-chip__name">{a.name}</span>
                <button className="bf-chip__x" onClick={() => conv.removeAttachment(a.key)} aria-label={t('app.remove', 'Remove')}>×</button>
              </span>
            ))}
          </div>
        )}
        <textarea
          className="bf-input"
          rows={2}
          placeholder={recipient
            ? t('app.messageParticipant', 'Message {name}…').replace('{name}', recipient.name)
            : t('app.placeholder', 'Ask BuilderForce to build or change something…')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <div className="bf-composer__actions">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => { attachFiles(e.target.files); e.target.value = ''; }}
          />

          {/* Recipient selector — only once the chat is multi-party. Routes the
              next message to the BRAIN (executes) or a participant (talked to). */}
          {participants.length > 0 && (
            <PopoverMenu
              align="left"
              triggerClassName={`bf-recipient${recipient ? ' is-active' : ''}`}
              title={t('app.recipientPickerTitle', 'Send to')}
              trigger={
                <span className="bf-recipient__inner">
                  <span className="bf-recipient__to">{t('app.to', 'To')}</span>
                  {recipient ? <Avatar name={recipient.name} kind={recipient.kind} size={16} /> : <IconBolt />}
                  <span className="bf-recipient__name">{recipient ? recipient.name : t('app.brainRecipient', 'BuilderForce')}</span>
                  <span aria-hidden>▾</span>
                </span>
              }
            >
              {(close) => (
                <>
                  <div className="bf-menu__group">{t('app.recipientPickerTitle', 'Send to')}</div>
                  <MenuItem
                    icon={<IconBolt />}
                    label={t('app.brainRecipient', 'BuilderForce')}
                    hint={t('app.brainRecipientHint', 'Runs it')}
                    active={!recipient}
                    onClick={() => { setRecipientChoice('brain'); close(); }}
                  />
                  {participants.map((p) => (
                    <MenuItem
                      key={p.ref}
                      icon={<Avatar name={p.name} kind={p.kind} size={16} />}
                      label={p.name}
                      hint={t('app.chatRecipientHint', 'Chat')}
                      active={recipient?.ref === p.ref}
                      onClick={() => { setRecipientChoice(p); close(); }}
                    />
                  ))}
                </>
              )}
            </PopoverMenu>
          )}

          {/* + : add content to the message (upload, workspace context, or web). */}
          <PopoverMenu align="left" title={t('app.add', 'Add')} trigger={<IconPlus />}>
            {(close) => (
              <>
                <MenuItem
                  icon="💻"
                  label={conv.uploading ? t('app.uploading', 'Uploading…') : t('app.uploadFile', 'Upload from computer')}
                  onClick={() => { close(); if (!conv.uploading) fileInputRef.current?.click(); }}
                />
                <MenuItem
                  icon="◧"
                  label={t('app.addContext', 'Add context')}
                  onClick={() => { close(); void addContext(); }}
                />
                <MenuItem
                  icon="🌐"
                  label={t('app.browseWeb', 'Browse the web')}
                  hint={webBrowsing ? t('app.on', 'On') : t('app.off', 'Off')}
                  active={webBrowsing}
                  onClick={() => setWebBrowsing((v) => !v)}
                />
              </>
            )}
          </PopoverMenu>

          {/* / : effort, thinking, and account settings. */}
          <PopoverMenu align="left" title={t('app.options', 'Options')} trigger={<IconSlash />}>
            {(close) => (
              <>
                <div className="bf-menu__group">{t('app.effort', 'Effort')}</div>
                <MenuItem icon="🏃" label={t('app.effortQuick', 'Quick')} active={effort === 'quick'} onClick={() => setEffort('quick')} />
                <MenuItem icon="⚖️" label={t('app.effortBalanced', 'Balanced')} active={effort === 'balanced'} onClick={() => setEffort('balanced')} />
                <MenuItem icon="🎯" label={t('app.effortThorough', 'Thorough')} active={effort === 'thorough'} onClick={() => setEffort('thorough')} />
                <div className="bf-menu__sep" />
                <MenuItem
                  icon="💭"
                  label={t('app.thinking', 'Thinking')}
                  hint={thinking ? t('app.on', 'On') : t('app.off', 'Off')}
                  active={thinking}
                  onClick={() => setThinking((v) => !v)}
                />
                <div className="bf-menu__sep" />
                <MenuItem icon="⚙" label={t('app.accountSettings', 'Account settings')} onClick={() => { close(); post('settings'); }} />
              </>
            )}
          </PopoverMenu>

          {/* Auto mode = auto-approve tool actions (same gate as the confirm dialog). */}
          <button
            type="button"
            className={`bf-toggle${autoApprove ? ' is-on' : ''}`}
            title={t('app.autoModeHint', 'Auto-approve tool actions without asking')}
            aria-pressed={autoApprove}
            onClick={() => setAutoApproveMode(!autoApprove)}
          >
            <IconBolt />
            <span>{t('app.autoMode', 'Auto mode')}</span>
          </button>

          {/* Consolidate: compress the chat into a summary marker the rest of the
              conversation builds on. Fork: branch that summary into a new chat. */}
          <button
            type="button"
            className="bf-toggle"
            title={t('app.consolidateHint', 'Summarize this chat into a compact context the rest of the conversation builds on')}
            aria-label={t('app.consolidate', 'Consolidate')}
            disabled={!canConsolidate || consolidating}
            onClick={consolidate}
          >
            <IconConsolidate />
            <span>{consolidating ? t('app.consolidating', 'Consolidating…') : t('app.consolidate', 'Consolidate')}</span>
          </button>
          <button
            type="button"
            className="bf-toggle"
            title={t('app.forkHint', 'Summarize this chat and continue in a new one from that summary')}
            aria-label={t('app.fork', 'Fork')}
            disabled={!canConsolidate || forking}
            onClick={fork}
          >
            <IconFork />
            <span>{forking ? t('app.forking', 'Forking…') : t('app.fork', 'Fork')}</span>
          </button>

          <div className="bf-header__spacer" />

          {init.model && (
            <button
              type="button"
              className="bf-model bf-model--btn"
              title={t('app.pickModel', 'Change model')}
              onClick={() => post('pickModel')}
            >
              {init.model}
            </button>
          )}

          {/* Speech-to-text — only where the runtime supports it, and never while a
              run is streaming (the composer is otherwise showing Stop). */}
          {speechSupported && !conv.sending && (
            <button
              type="button"
              className={`bf-iconbtn${listening ? ' is-listening' : ''}`}
              title={listening ? t('app.stopDictation', 'Stop dictation') : t('app.dictate', 'Dictate')}
              aria-label={listening ? t('app.stopDictation', 'Stop dictation') : t('app.dictate', 'Dictate')}
              aria-pressed={listening}
              onClick={toggleMic}
            >
              <IconMic />
            </button>
          )}

          {/* While a run is in flight the primary action becomes Stop — it aborts
              the streaming LLM request and unwinds the agent loop (conv.stop). */}
          {conv.sending ? (
            <button className="bf-btn bf-btn--stop" onClick={conv.stop} title={t('app.stop', 'Stop')}>
              <span className="bf-stop-glyph" aria-hidden="true">■</span> {t('app.stop', 'Stop')}
            </button>
          ) : (
            <button
              className="bf-iconbtn bf-iconbtn--send"
              onClick={submit}
              disabled={!input.trim()}
              title={t('app.send', 'Send')}
              aria-label={t('app.send', 'Send')}
            >
              <IconSend />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
