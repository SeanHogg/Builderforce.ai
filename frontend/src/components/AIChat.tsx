'use client';

import { useState, useRef, useEffect } from 'react';
import type { AIMessage } from '@/lib/types';
import { sendAIMessage } from '@/lib/api';

interface AIChatProps {
  projectId: string | number;
  /** Task 3: Provide the currently open file path as context */
  activeFile?: string;
  /** Task 3: Provide the currently open file content as context */
  activeFileContent?: string;
  /** Task 10: Callback when AI suggests code to apply to the current file */
  onApplyCode?: (code: string) => void;
}

/** Task 4: Minimal markdown renderer — handles code blocks and inline code */
function renderMessage(content: string, onApplyCode?: (code: string) => void) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    const blockMatch = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (blockMatch) {
      const lang = blockMatch[1] || 'text';
      const code = blockMatch[2].trimEnd();
      return (
        <div key={i} style={{ position: 'relative', margin: '8px 0', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-deep)', padding: '4px 10px' }}>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{lang}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => navigator.clipboard?.writeText(code)}
                style={{ fontSize: '0.68rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}
              >Copy</button>
              {onApplyCode && (
                <button
                  onClick={() => onApplyCode(code)}
                  style={{ fontSize: '0.68rem', color: 'var(--coral-bright)', background: 'var(--surface-coral-soft)', border: '1px solid var(--border-accent)', cursor: 'pointer', padding: '2px 8px', borderRadius: 4, fontFamily: 'var(--font-display)', fontWeight: 600 }}
                >
                  Apply →
                </button>
              )}
            </div>
          </div>
          <pre style={{ margin: 0, padding: '10px 12px', background: 'var(--bg-elevated)', overflowX: 'auto', fontSize: '0.78rem', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre' }}>
            <code>{code}</code>
          </pre>
        </div>
      );
    }
    // Inline code
    const inlineParts = part.split(/(`[^`]+`)/g);
    return (
      <span key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, fontSize: '0.82rem' }}>
        {inlineParts.map((inline, j) => {
          if (inline.startsWith('`') && inline.endsWith('`') && inline.length > 2) {
            return (
              <code key={j} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '1px 5px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: 'var(--coral-bright)' }}>
                {inline.slice(1, -1)}
              </code>
            );
          }
          return <span key={j}>{inline}</span>;
        })}
      </span>
    );
  });
}

export function AIChat({ projectId, activeFile, activeFileContent, onApplyCode }: AIChatProps) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(scrollToBottom, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: AIMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const assistantMessage: AIMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      // Task 3: Build a context-aware message list with system prompt injected
      const systemContent = [
        'You are an expert AI coding assistant built into Builderforce.ai, a browser-based IDE.',
        'When you write code, always use markdown code blocks with the correct language tag.',
        activeFile ? `The user currently has the file \`${activeFile}\` open.` : '',
        activeFileContent ? `\n\nHere is the current content of that file:\n\`\`\`\n${activeFileContent.slice(0, 4000)}\n\`\`\`` : '',
      ].filter(Boolean).join('\n');

      const apiMessages = [
        { role: 'system' as const, content: systemContent },
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: input.trim() },
      ];

      await sendAIMessage(
        projectId,
        apiMessages,
        (chunk) => {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMessage.id
                ? { ...m, content: m.content + chunk }
                : m
            )
          );
        }
      );
    } catch {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMessage.id
            ? { ...m, content: '⚠️ Failed to get a response. Check your connection and try again.' }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 16px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>💬</div>
            <p style={{ fontSize: '0.9rem', marginBottom: 6, color: 'var(--text-primary)' }}>Ask me anything about your code!</p>
            {activeFile ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                I can see <strong style={{ color: 'var(--coral-bright)' }}>{activeFile}</strong><br />
                Ask me to explain, refactor, or add features.
              </p>
            ) : (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Open a file to get context-aware suggestions.
              </p>
            )}
          </div>
        )}
        {messages.map(message => (
          <div
            key={message.id}
            style={{
              borderRadius: 10,
              padding: '8px 10px',
              background: message.role === 'user' ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
              border: `1px solid ${message.role === 'user' ? 'var(--border-accent)' : 'var(--border-subtle)'}`,
              marginLeft: message.role === 'user' ? 16 : 0,
              marginRight: message.role === 'user' ? 0 : 16,
            }}
          >
            <div style={{ fontSize: '0.68rem', fontWeight: 700, marginBottom: 4, color: message.role === 'user' ? 'var(--coral-bright)' : 'var(--text-secondary)', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {message.role === 'user' ? 'You' : '🤖 AI'}
            </div>
            <div>
              {/* Task 4: render markdown with code blocks */}
              {message.content
                ? renderMessage(message.content, message.role === 'assistant' ? onApplyCode : undefined)
                : <span style={{ color: 'var(--text-muted)', animation: 'pulse 1.2s ease-in-out infinite', fontSize: '0.82rem' }}>Thinking…</span>
              }
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask AI... (Enter to send)"
            style={{
              flex: 1, background: 'var(--bg-base)', color: 'var(--text-primary)',
              fontSize: '0.85rem', borderRadius: 10, padding: '10px 12px',
              resize: 'none', outline: 'none',
              border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-body)',
              lineHeight: 1.4,
            }}
            rows={2}
            disabled={isLoading}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--coral-bright)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            style={{
              background: isLoading || !input.trim() ? 'var(--bg-elevated)' : 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: '#fff', border: 'none', borderRadius: 10,
              padding: '10px 16px', cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
              fontSize: '0.85rem',
              fontFamily: 'var(--font-display)', fontWeight: 600,
              opacity: isLoading || !input.trim() ? 0.5 : 1,
              flexShrink: 0,
              height: 42,
            }}
          >
            {isLoading ? '⏳' : '→'}
          </button>
        </div>
      </div>
    </div>
  );
}
