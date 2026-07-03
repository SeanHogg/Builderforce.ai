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
import { BrainTimeline, type BrainTimelineLabels } from '@seanhogg/builderforce-brain-ui';
import {
  getToken,
  onInit,
  onIntent,
  onTokenChange,
  post,
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
import { activeProjectDirective } from '../../src/idePersona';
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
  if (init.view === 'backlog' || init.view === 'prd') return <ProjectPageScreen init={init} view={init.view} />;
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
      if (info.mutating && info.ok) post('platform.write', { name: info.name });
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
    () => activeProjectDirective(init.project),
    [init.project?.id, init.project?.name],
  );

  const conv = useBrainConversation({
    chatId,
    modality: 'ide',
    model: init.model,
    extraSystem: projectDirective,
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    for (const f of Array.from(files)) void conv.attach(f);
  }, [conv]);

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
    void conv.send(text);
  }, [input, conv]);

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

      {conv.error && <div className="bf-error">{conv.error}</div>}

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
          <button className="bf-btn" title={t('app.attachImage', 'Attach image')} onClick={() => fileInputRef.current?.click()} disabled={conv.uploading}>
            {conv.uploading ? '…' : '📎'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => { attachFiles(e.target.files); e.target.value = ''; }}
          />
          {init.model && <span className="bf-model">{init.model}</span>}
          <div className="bf-header__spacer" />
          {/* While a run is in flight the primary action becomes Stop — it aborts
              the streaming LLM request and unwinds the agent loop (conv.stop). */}
          {conv.sending ? (
            <button className="bf-btn bf-btn--stop" onClick={conv.stop} title={t('app.stop', 'Stop')}>
              <span className="bf-stop-glyph" aria-hidden="true">■</span> {t('app.stop', 'Stop')}
            </button>
          ) : (
            <button className="bf-btn bf-btn--primary" onClick={submit} disabled={!input.trim()}>
              {t('app.send', 'Send')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
