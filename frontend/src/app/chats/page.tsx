'use client';

import { useState, useEffect } from 'react';
import { chatSessionsApi, type ChatSession, type ChatMessage } from '@/lib/builderforceApi';

type SessionWithName = ChatSession & { clawName?: string };

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export default function ChatsPage() {
  const [sessions, setSessions] = useState<SessionWithName[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SessionWithName | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    chatSessionsApi.listAll(100)
      .then(setSessions)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const selectSession = async (s: SessionWithName) => {
    setSelected(s);
    setMessages([]);
    setLoadingMsgs(true);
    try {
      const msgs = await chatSessionsApi.getMessages(s.id, 200);
      setMessages(msgs);
    } finally {
      setLoadingMsgs(false);
    }
  };

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Chats</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            All chat sessions across claws in this workspace
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          style={{
            padding: '7px 14px', fontSize: 13, fontWeight: 600,
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>
          Error: {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading sessions…</div>
      ) : sessions.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
          No chat sessions yet. Chat history will appear here once claws start receiving messages.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) 1fr', gap: 16, height: 'clamp(420px, calc(100dvh - 280px), 760px)' }}>
          {/* Session list */}
          <div style={{ ...cardStyle, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Sessions ({sessions.length})
            </div>
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void selectSession(s)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  padding: '8px 10px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', width: '100%',
                  background: selected?.id === s.id ? 'var(--surface-interactive)' : 'transparent',
                  border: `1px solid ${selected?.id === s.id ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                }}
              >
                <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                    {s.sessionKey}
                  </span>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-muted)', flexShrink: 0 }}>
                    {s.msgCount} msgs
                  </span>
                </div>
                <div style={{ display: 'flex', width: '100%', gap: 4, marginTop: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.clawName ?? `claw ${s.clawId}`}
                  </span>
                  <span>{s.lastMsgAt ? new Date(s.lastMsgAt).toLocaleString() : '—'}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Message thread */}
          <div style={{ ...cardStyle, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {!selected ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: 'auto' }}>
                Select a session to view its messages.
              </div>
            ) : (
              <>
                <div style={{ flexShrink: 0, marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{selected.sessionKey}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                    {selected.clawName ?? `claw ${selected.clawId}`} · {selected.startedAt ? new Date(selected.startedAt).toLocaleString() : '—'}
                  </span>
                </div>
                <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {loadingMsgs ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading messages…</div>
                  ) : messages.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No messages.</div>
                  ) : (
                    messages.map((m) => (
                      <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: m.role === 'user' ? 'var(--cyan-bright, #22d3ee)' : 'var(--text-muted)', textTransform: 'uppercase' }}>
                          {m.role}
                        </div>
                        <div style={{
                          fontSize: 13, color: 'var(--text-primary)',
                          background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 12px',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {m.content}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
