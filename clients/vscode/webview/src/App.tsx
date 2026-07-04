import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainProvider,
  BrainActionsProvider,
  useRegisterBrainActions,
  useBrainActions,
  useBrainConversation,
  useBrainConfig,
  useMcpExtensions,
  type BrainConfig,
  type BrainChat,
} from '@seanhogg/builderforce-brain-embedded';
import { BrainTimeline, ChatTicketsPanel, DEFAULT_CHAT_TICKETS_LABELS, type BrainTimelineLabels } from '@seanhogg/builderforce-brain-ui';
import { createChatTicketsAdapter } from './chatTicketsAdapter';
import {
  getToken,
  onInit,
  onIntent,
  onTokenChange,
  post,
  request,
  refreshToken,
  type BrainIntent,
  type InitData,
  type LabelBundle,
} from './vscodeBridge';
import { Project360Screen } from './Project360Screen';
import { ProjectPageScreen } from './ProjectPageScreen';
import { createPersistence } from './persistence';
import { buildHostTools } from './hostTools';
import { buildIdeSystemPrompt } from './systemPrompt';
import { activeProjectDirective, deltaVisibilityDirective } from '../../src/idePersona';
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

/**
 * A small popover menu (the `+` and `/` composer affordances). Closes on outside
 * click or Escape. `children` is a render prop given a `close()` so an item can
 * dismiss the menu after acting. Shared by both composer menus (DRY).
 */
function PopoverMenu({
  trigger, title, align = 'left', children,
}: {
  trigger: React.ReactNode;
  title: string;
  align?: 'left' | 'right';
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
        className={`bf-iconbtn${open ? ' is-active' : ''}`}
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
    onInit(setInit);
    return onTokenChange(() => force((n) => n + 1));
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
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
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

  const reloadChats = useCallback(() => {
    persistence.listChats({ limit: 50 })
      .then((list) => { setChats(list); post('chats.changed'); })
      .catch(() => {});
  }, [persistence]);
  useEffect(() => { reloadChats(); }, [reloadChats]);

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

  // Fold the composer toggles (effort / thinking / web) into the same system
  // channel as the project context, so the next turn honors them.
  const extraSystem = useMemo(
    () => [projectDirective, buildComposerDirectives({ effort, thinking, web: webBrowsing })]
      .filter(Boolean)
      .join('\n\n'),
    [projectDirective, effort, thinking, webBrowsing],
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

  // Host-driven intents: the Sessions sidebar / task commands drive this singleton
  // panel (open a fresh chat, focus an existing one, or seed a task-scoped chat).
  useEffect(() => {
    return onIntent((intent: BrainIntent) => {
      if (intent.kind === 'new') {
        setChatId(null);
        setInput('');
      } else if (intent.kind === 'seed') {
        // Fresh chat pre-filled with an editor entry point's prompt (review PRs / fix
        // errors / open a PR); the user can tweak before sending.
        setChatId(null);
        setInput(intent.text ?? '');
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
          })
          .catch(() => {});
      }
    });
  }, [persistence, reloadChats, t]);

  // Chat↔ticket panel data adapter — same gateway endpoints as the web app's
  // panel, over the webview's bearer fetch (see chatTicketsAdapter).
  const ticketAdapter = useMemo(
    () => createChatTicketsAdapter(init.baseUrl, getToken, () => void refreshToken()),
    [init.baseUrl],
  );
  // Bumped when the Brain mutates work items via MCP tools, so the ticket panel
  // refreshes live (rings/links) rather than only on its own button actions.
  const [ticketRefresh, setTicketRefresh] = useState(0);
  useEffect(() => {
    const h = () => setTicketRefresh((n) => n + 1);
    window.addEventListener('bf:mcp-write', h);
    return () => window.removeEventListener('bf:mcp-write', h);
  }, []);

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
    // they've started typing in the meantime.
    void conv.send(text).then((ok) => { if (!ok) setInput((cur) => cur || text); });
  }, [input, conv]);

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
  const canCopy = hasTranscriptContent({ messages: conv.messages, trace: conv.trace, error: conv.error });
  const copyTranscript = useCallback(() => {
    post('copy', {
      text: buildTranscript({
        messages: conv.messages,
        trace: conv.trace,
        assistantName: 'BuilderForce',
        model: init.model,
        error: conv.error,
      }),
    });
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [conv.messages, conv.trace, conv.error, init.model]);

  return (
    <div className="bf-app">
      <header className="bf-header">
        <span className="bf-header__title">BuilderForce</span>
        <span className="bf-header__beta">{t('app.beta', 'beta')}</span>
        <div className="bf-header__spacer" />
        <select
          className="bf-select"
          value={chatId ?? ''}
          onChange={(e) => setChatId(e.target.value ? Number(e.target.value) : null)}
          aria-label={t('app.conversation', 'Conversation')}
        >
          <option value="">{t('app.newChat', 'New chat')}</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id}>{c.title || `Chat ${c.id}`}</option>
          ))}
        </select>
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
            chatList={chats.map((c) => ({ id: c.id, title: c.title }))}
            adapter={ticketAdapter}
            labels={DEFAULT_CHAT_TICKETS_LABELS}
            onChanged={() => { reloadChats(); conv.reloadMessages(); }}
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
          labels={timelineLabels(init.labels)}
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
          placeholder={t('app.placeholder', 'Ask BuilderForce to build or change something…')}
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
