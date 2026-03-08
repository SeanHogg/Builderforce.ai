'use client';

import { useState, useRef, useEffect } from 'react';
import type { AIMessage } from '@/lib/types';
import { sendAIMessage } from '@/lib/api';
import { ChatInput } from '@/components/ChatInput';
import { ChatMessageContent } from '@/components/ChatMessageContent';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const assistantContentRef = useRef('');

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  useEffect(scrollToBottom, [messages]);

  useEffect(() => {
    if (initialMessages) setMessages(initialMessages);
  }, [initialMessages]);

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
      const systemContent = [
        'You are an expert AI coding assistant built into Builderforce.ai, a browser-based IDE. Help users generate and build apps.',
        'Use markdown for your response: headings, lists, bold, and fenced code blocks.',
        'When suggesting new or existing files, use a code block with the file path as the language tag so the user can create the file in one click. Examples: ```package.json (then JSON content), ```src/index.js (then JS content), ```.gitignore (then content).',
        'When you write code for the currently open file, use a normal code block (e.g. ```javascript) so the user can apply it.',
        activeFile ? `The user currently has the file \`${activeFile}\` open.` : '',
        activeFileContent ? `\n\nCurrent content of that file:\n\`\`\`\n${activeFileContent.slice(0, 4000)}\n\`\`\`` : '',
      ].filter(Boolean).join('\n');

      const apiMessages = [
        { role: 'system' as const, content: systemContent },
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: input.trim() },
      ];

      await sendAIMessage(projectId, apiMessages, chunk => {
        assistantContentRef.current += chunk;
        setMessages(prev =>
          prev.map(m => (m.id === assistantMessage.id ? { ...m, content: m.content + chunk } : m))
        );
      });
      onMessagesPersisted?.(
        { role: 'user', content: userContent },
        { role: 'assistant', content: assistantContentRef.current }
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
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              {message.content ? (
                <ChatMessageContent
                  content={message.content}
                  onApplyCode={message.role === 'assistant' ? onApplyCode : undefined}
                  onCreateFile={message.role === 'assistant' ? onCreateFile : undefined}
                />
              ) : (
                <span style={{ color: 'var(--text-muted)', animation: 'pulse 1.2s ease-in-out infinite', fontSize: '0.82rem' }}>Thinking…</span>
              )}
            </div>
          </div>
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
    </div>
  );
}
