'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ClawGateway } from '@/lib/clawGateway';
import { claws, dispatchApi } from '@/lib/builderforceApi';

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sessionKey?: string;
  ts: number;
}

interface ClawChatContentProps {
  clawId: number;
  clawName?: string;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const STATUS_COLORS: Record<string, string> = {
  connected: 'var(--cyan-bright, #00e5cc)',
  connecting: 'var(--text-muted)',
  offline: 'var(--text-muted)',
  error: 'var(--coral-bright, #f4726e)',
};

export function ClawChatContent({ clawId, clawName }: ClawChatContentProps) {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'offline' | 'error'>('connecting');
  const [sending, setSending] = useState(false);
  const gatewayRef = useRef<ClawGateway | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const url = claws.wsUrl(clawId);
    setConnStatus('connecting');

    const gateway = new ClawGateway({
      url,
      onEvent: (ev) => {
        if (ev.type === 'connected') {
          setConnStatus('connected');
        } else if (ev.type === 'disconnected') {
          setConnStatus('offline');
          // Reconnect after 3s
          setTimeout(() => {
            if (gatewayRef.current === gateway) {
              setConnStatus('connecting');
              gateway['connect']?.();
            }
          }, 3000);
        } else if (ev.type === 'claw_offline') {
          setConnStatus('offline');
        } else if (ev.type === 'claw_online') {
          setConnStatus('connected');
        } else if (ev.type === 'message') {
          const data = ev.data as Record<string, unknown>;
          if (data?.type === 'chat.message') {
            const msg = data as {
              type: string;
              role?: string;
              content?: string;
              sessionKey?: string;
            };
            if (msg.content) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `${Date.now()}-${Math.random()}`,
                  role: (msg.role as ChatEntry['role']) ?? 'assistant',
                  content: msg.content!,
                  sessionKey: msg.sessionKey,
                  ts: Date.now(),
                },
              ]);
              scrollToBottom();
            }
          }
        }
      },
    });

    gatewayRef.current = gateway;
    return () => {
      gateway.destroy();
      gatewayRef.current = null;
    };
  }, [clawId, scrollToBottom]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    const entry: ChatEntry = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: text,
      ts: Date.now(),
    };
    setMessages((prev) => [...prev, entry]);
    setInput('');
    scrollToBottom();
    try {
      // Try sending via WS first; fall back to HTTP dispatch
      const sent = gatewayRef.current?.send({ type: 'chat.message', role: 'user', content: text });
      if (!sent) {
        await dispatchApi.send(clawId, { type: 'chat.message', role: 'user', content: text });
      }
    } catch {
      // Non-fatal; message is already shown optimistically
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0, minHeight: 0 }}>
      {/* Status bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 0 12px',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: 12,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: STATUS_COLORS[connStatus] ?? 'var(--text-muted)',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {connStatus === 'connected'
            ? `Connected to ${clawName ?? `claw #${clawId}`}`
            : connStatus === 'connecting'
              ? 'Connecting…'
              : connStatus === 'offline'
                ? 'Claw offline — waiting to reconnect'
                : 'Connection error'}
        </span>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages([])}
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: 'var(--text-muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        {messages.length === 0 && (
          <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No messages yet.{' '}
            {connStatus === 'connected'
              ? 'Send a message below to chat with the claw.'
              : 'Waiting for claw to connect.'}
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '85%',
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 13,
                lineHeight: 1.55,
                background:
                  msg.role === 'user'
                    ? 'var(--surface-coral-soft, rgba(244,114,94,0.15))'
                    : msg.role === 'system'
                      ? 'var(--bg-elevated)'
                      : 'var(--bg-base)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {msg.content}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, paddingInline: 4 }}>
              {msg.role === 'user' ? 'You' : clawName ?? 'Claw'} ·{' '}
              {new Date(msg.ts).toLocaleTimeString()}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        style={{
          flexShrink: 0,
          paddingTop: 12,
          borderTop: '1px solid var(--border-subtle)',
          marginTop: 12,
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            connStatus === 'connected'
              ? 'Send a message… (Enter to send, Shift+Enter for newline)'
              : 'Waiting for claw connection…'
          }
          disabled={connStatus !== 'connected' || sending}
          rows={2}
          style={{
            flex: 1,
            padding: '10px 12px',
            fontSize: 13,
            lineHeight: 1.5,
            background: 'var(--bg-base)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            resize: 'none',
            outline: 'none',
            fontFamily: 'inherit',
            opacity: connStatus !== 'connected' ? 0.5 : 1,
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || connStatus !== 'connected' || sending}
          style={{
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 8,
            border: 'none',
            background: 'var(--coral-bright, #f4726e)',
            color: '#fff',
            cursor: !input.trim() || connStatus !== 'connected' || sending ? 'not-allowed' : 'pointer',
            opacity: !input.trim() || connStatus !== 'connected' || sending ? 0.5 : 1,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
