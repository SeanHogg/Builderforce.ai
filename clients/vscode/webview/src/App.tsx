import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainProvider,
  BrainActionsProvider,
  useRegisterBrainActions,
  useBrainActions,
  useBrainConversation,
  useBrainConfig,
  type BrainConfig,
  type BrainChat,
} from '@seanhogg/builderforce-brain-embedded';
import { BrainTimeline } from '@seanhogg/builderforce-brain-ui';
import { getToken, onInit, onTokenChange, post, refreshToken, type InitData } from './vscodeBridge';
import { createPersistence } from './persistence';
import { buildHostTools } from './hostTools';
import { buildIdeSystemPrompt } from './systemPrompt';

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
  if (!init.signedIn || !getToken()) {
    return (
      <div className="bf-center">
        <p>Sign in to BuilderForce to start.</p>
        <button className="bf-btn bf-btn--primary" onClick={() => post('signin')}>
          Sign in
        </button>
      </div>
    );
  }
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

function Chat({ init }: { init: InitData }) {
  const { persistence } = useBrainConfig();
  const { toolSpecs, runTool, isMutating } = useBrainActions();
  const [chatId, setChatId] = useState<number | null>(null);
  const [chats, setChats] = useState<BrainChat[]>([]);
  const [autoApprove, setAutoApprove] = useState(false);
  const [input, setInput] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const reloadChats = useCallback(() => {
    persistence.listChats({ limit: 50 }).then(setChats).catch(() => {});
  }, [persistence]);
  useEffect(() => { reloadChats(); }, [reloadChats]);

  const needsConfirm = useCallback(
    (req: { name: string; args: unknown }) => !autoApprove && isMutating(req.name, req.args),
    [autoApprove, isMutating],
  );

  const ensureChatId = useCallback(async () => {
    if (chatId != null) return chatId;
    const chat = await persistence.createChat({ title: 'New chat', projectId: null });
    setChatId(chat.id);
    reloadChats();
    return chat.id;
  }, [chatId, persistence, reloadChats]);

  const conv = useBrainConversation({
    chatId,
    modality: 'ide',
    model: init.model,
    toolSpecs,
    runTool,
    needsConfirm,
    ensureChatId,
    onActivity: reloadChats,
  });

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

  return (
    <div className="bf-app">
      <header className="bf-header">
        <span className="bf-header__title">BuilderForce</span>
        <span className="bf-header__beta">beta</span>
        <div className="bf-header__spacer" />
        <select
          className="bf-select"
          value={chatId ?? ''}
          onChange={(e) => setChatId(e.target.value ? Number(e.target.value) : null)}
          aria-label="Conversation"
        >
          <option value="">New chat</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id}>{c.title || `Chat ${c.id}`}</option>
          ))}
        </select>
        <button className="bf-btn" title="New chat" onClick={() => setChatId(null)}>＋</button>
      </header>

      <div className="bf-body">
        <BrainTimeline
          messages={conv.messages}
          trace={conv.trace}
          streamingText={conv.sending ? conv.streamingText : ''}
          isRunning={conv.sending}
          loading={conv.loadingMessages}
          assistantName="BuilderForce"
        />
      </div>

      {conv.error && <div className="bf-error">{conv.error}</div>}

      {conv.pendingConfirm && (
        <div className="bf-confirm">
          <span>
            Run <code>{conv.pendingConfirm.name}</code>?
          </span>
          <div className="bf-confirm__actions">
            <button className="bf-btn bf-btn--primary" onClick={() => conv.resolveConfirm(true)}>Approve</button>
            <button className="bf-btn" onClick={() => conv.resolveConfirm(false)}>Cancel</button>
            <label className="bf-confirm__auto">
              <input type="checkbox" checked={autoApprove} onChange={(e) => { setAutoApprove(e.target.checked); if (e.target.checked) conv.resolveConfirm(true); }} />
              Always
            </label>
          </div>
        </div>
      )}

      <div
        className={`bf-composer${dragOver ? ' bf-composer--drag' : ''}`}
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
                <button className="bf-chip__x" onClick={() => conv.removeAttachment(a.key)} aria-label="Remove">×</button>
              </span>
            ))}
          </div>
        )}
        <textarea
          className="bf-input"
          rows={2}
          placeholder="Ask BuilderForce to build or change something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <div className="bf-composer__actions">
          <button className="bf-btn" title="Attach image" onClick={() => fileInputRef.current?.click()} disabled={conv.uploading}>
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
          <button className="bf-btn bf-btn--primary" onClick={submit} disabled={conv.sending || !input.trim()}>
            {conv.sending ? 'Working…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
