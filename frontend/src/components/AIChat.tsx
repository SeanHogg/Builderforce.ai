'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { AIMessage, InferenceMode } from '@/lib/types';
import { sendAIMessage } from '@/lib/api';
import { isPlanLimitError, type PlanLimitError } from '@/lib/planLimitError';
import { ChatInput } from '@/components/ChatInput';
import { ChatMessageBubble } from '@/components/ChatMessageBubble';
import { ChatMessageActions } from '@/components/ChatMessageActions';
import { UpgradeModal } from '@/components/UpgradeModal';
import { MambaEngine } from '@/lib/mamba-engine';
import { MambaModelProvider } from '@/lib/model-provider';

interface AIChatProps {
  projectId: number | string;
  activeFile?: string;
  activeFileContent?: string;
  onApplyCode?: (code: string) => void;
  onCreateFile?: (path: string, content: string) => void;
  /** When provided, initialize messages (e.g. from a saved chat). Reset when reference changes. */
  initialMessages?: AIMessage[];
  /** Called after a successful send with the new user and assistant message content for persistence. */
  onMessagesPersisted?: (user: { role: string; content: string }, assistant: { role: string; content: string }) => void;
  /** When provided, clicking Up arrow runs this instead of sending to IDE AI (e.g. start a new Brain Storm session and redirect). */
  onStartBrainStormSession?: (message: string) => void | Promise<void>;
}

export function AIChat({ projectId, activeFile, activeFileContent, onApplyCode, onCreateFile, initialMessages, onMessagesPersisted, onStartBrainStormSession }: AIChatProps) {
  const [messages, setMessages] = useState<AIMessage[]>(initialMessages ?? []);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  // Local/hybrid inference requires tokenizer assets + WebGPU weights that
  // aren't shipped yet; cloud is the only functional path today. The toggle
  // is still rendered so the feature is discoverable, but the non-cloud
  // buttons are disabled until the on-device stack lands.
  const [inferenceMode, setInferenceMode] = useState<InferenceMode>('cloud');
  const [planError, setPlanError] = useState<PlanLimitError | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const assistantContentRef = useRef('');
  const mambaRef = useRef<MambaEngine | null>(null);
  const mambaProviderRef = useRef<MambaModelProvider | null>(null);

  const copyMessage = useCallback(async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((i) => (i === id ? null : i)), 2000);
    } catch { /* ignore */ }
  }, []);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(scrollToBottom, [messages]);

  useEffect(() => {
    if (initialMessages) setMessages(initialMessages);
  }, [initialMessages]);

  // Lazily initialise Mamba engine when memory is enabled
  useEffect(() => {
    if (!memoryEnabled) return;
    const agentId = `chat-${projectId}`;
    const engine = new MambaEngine(agentId, projectId);
    void engine.init().then(() => engine.loadFromIndexedDB());
    mambaRef.current = engine;
    return () => { mambaRef.current = null; };
  }, [memoryEnabled, projectId]);

  // Lazily initialise MambaModelProvider for local/hybrid inference
  useEffect(() => {
    if (inferenceMode === 'cloud') {
      mambaProviderRef.current?.dispose?.();
      mambaProviderRef.current = null;
      return;
    }
    if (mambaProviderRef.current) return;
    const provider = new MambaModelProvider();
    void provider.init();
    mambaProviderRef.current = provider;
  }, [inferenceMode]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userContent = input.trim();

    if (onStartBrainStormSession) {
      setInput('');
      await onStartBrainStormSession(userContent);
      return;
    }
    const userMessage: AIMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userContent,
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    assistantContentRef.current = '';

    const assistantMessage: AIMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      // 1. Advance Mamba state and get memory context (if enabled)
      let memoryContext = '';
      if (memoryEnabled && mambaRef.current) {
        memoryContext = await mambaRef.current.step(userContent);
        void mambaRef.current.save();
      }

      const systemParts: string[] = [
        'You are an expert AI coding assistant built into Builderforce.ai, a browser-based IDE. Help users generate and build apps.',
        'Use markdown for your response: headings, lists, bold, and fenced code blocks.',
        'When suggesting new or existing files, use a code block with the file path as the language tag so the user can create the file in one click. Examples: ```package.json (then JSON content), ```src/index.js (then JS content), ```.gitignore (then content).',
        'When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it.',
        activeFile ? `The user currently has the file \`${activeFile}\` open.` : '',
        activeFileContent ? `\n\nCurrent content of that file:\n\`\`\`\n${activeFileContent.slice(0, 4000)}\n\`\`\`` : '',
      ];

      // 3. Inject memory context if enabled
      if (memoryContext) {
        systemParts.push(`\n\nAgent memory context: ${memoryContext}`);
      }

      const systemContent = systemParts.filter(Boolean).join('\n');

      const apiMessages = [
        { role: 'system' as const, content: systemContent },
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: input.trim() },
      ];

      // 4. Run inference:
      //    local  → MambaModelProvider (on-device WebGPU); falls back to cloud if not ready
      //    hybrid → MambaModelProvider first; cloud fallback if Mamba not ready
      //    cloud  → sendAIMessage (Workers AI proxy) always
      const mambaProvider = mambaProviderRef.current;
      const useMamba =
        inferenceMode !== 'cloud' && mambaProvider?.isReady();

      if (useMamba && mambaProvider) {
        const result = await mambaProvider.stream(
          userContent,
          {
            systemPrompt: systemContent,
            messages: apiMessages,
            memoryContext: memoryContext || undefined,
            fileContext: activeFileContent?.slice(0, 4000),
          },
          chunk => {
            assistantContentRef.current += chunk;
            setMessages(prev =>
              prev.map(m => (m.id === assistantMessage.id ? { ...m, content: m.content + chunk } : m))
            );
          }
        );
        assistantContentRef.current = result;
      } else {
        // Cloud path (or hybrid fallback when Mamba not ready)
        await sendAIMessage(projectId, apiMessages, chunk => {
          assistantContentRef.current += chunk;
          setMessages(prev =>
            prev.map(m => (m.id === assistantMessage.id ? { ...m, content: m.content + chunk } : m))
          );
        });
      }
      onMessagesPersisted?.(
        { role: 'user', content: userContent },
        { role: 'assistant', content: assistantContentRef.current }
      );
    } catch (e) {
      if (isPlanLimitError(e)) {
        setPlanError(e);
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMessage.id
              ? { ...m, content: `⚠️ ${e.message}` }
              : m
          )
        );
      } else {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMessage.id
              ? { ...m, content: '⚠️ Failed to get a response. Check your connection and try again.' }
              : m
          )
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      {/* Memory + Inference mode toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)',
        flexShrink: 0,
      }}>
        {/* Memory toggle */}
        <button
          onClick={() => setMemoryEnabled(m => !m)}
          title={memoryEnabled ? 'Memory ON — click to disable' : 'Memory OFF — click to enable'}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', fontWeight: 600,
            background: memoryEnabled ? 'rgba(139,92,246,0.2)' : 'transparent',
            color: memoryEnabled ? '#a78bfa' : 'var(--text-muted)',
            border: `1px solid ${memoryEnabled ? '#7c3aed' : 'var(--border-subtle)'}`,
            borderRadius: 6, padding: '2px 7px', cursor: 'pointer',
          }}
        >
          <span>🧬</span> Memory {memoryEnabled ? 'ON' : 'OFF'}
        </button>

        {/* Inference mode — local/hybrid are gated until on-device weights ship */}
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          {(['local', 'hybrid', 'cloud'] as InferenceMode[]).map(mode => {
            const disabled = mode !== 'cloud';
            const active = inferenceMode === mode;
            return (
              <button
                key={mode}
                onClick={() => { if (!disabled) setInferenceMode(mode); }}
                disabled={disabled}
                title={
                  disabled
                    ? `${mode === 'local' ? 'On-device' : 'Hybrid'} inference — coming soon`
                    : 'Cloud inference'
                }
                style={{
                  fontSize: '0.65rem', fontWeight: 600, textTransform: 'capitalize',
                  padding: '2px 7px', borderRadius: 5,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  border: 'none',
                  background: active ? 'var(--bg-elevated)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  opacity: disabled ? 0.45 : 1,
                }}
              >
                {mode === 'local' ? '💻' : mode === 'hybrid' ? '⚡' : '☁️'} {mode}
                {disabled && <span style={{ fontSize: '0.55rem', marginLeft: 3, opacity: 0.8 }}>·soon</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bs-messages" style={{ flex: 1, overflowY: 'auto' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 16px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>💬</div>
            <p style={{ fontSize: '0.9rem', marginBottom: 6, color: 'var(--text-primary)' }}>Ask me anything about your code!</p>
            {activeFile ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                I can see <strong style={{ color: 'var(--coral-bright)' }}>{activeFile}</strong><br />
                Ask me to explain, refactor, or add features. You can also ask to generate a new app or files.
              </p>
            ) : (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Open a file for context, or ask me to generate an app or create files.
              </p>
            )}
          </div>
        )}
        {messages.map((message) => (
          <ChatMessageBubble
            key={message.id}
            role={message.role as 'user' | 'assistant'}
            content={message.content}
            isStreaming={message.role === 'assistant' && !message.content}
            onApplyCode={onApplyCode}
            onCreateFile={onCreateFile}
            actions={
              message.role === 'assistant' && message.content ? (
                <ChatMessageActions
                  onCopy={() => copyMessage(message.content, message.id)}
                  copied={copiedId === message.id}
                  projectId={Number(projectId)}
                  assistantContent={message.content}
                  conversationMessages={messages.map((m) => ({ role: m.role, content: m.content }))}
                />
              ) : undefined
            }
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, background: 'var(--bg-elevated)' }}>
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={sendMessage}
          placeholder="Ask AI..."
          disabled={isLoading}
          rows={2}
          submitOnEnter={false}
          showBrainIcon={true}
          showVoice={true}
        />
      </div>

      <UpgradeModal
        error={planError}
        onClose={() => setPlanError(null)}
        title="Daily AI limit reached"
      />
    </div>
  );
}
