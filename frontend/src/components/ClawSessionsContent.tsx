'use client';

import { useState, useEffect } from 'react';
import { chatSessionsApi, claws, dispatchApi, type ChatSession, type ChatMessage, type Claw } from '@/lib/builderforceApi';

interface ClawSessionsContentProps {
  clawId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export function ClawSessionsContent({ clawId }: ClawSessionsContentProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  // Handoff state
  const [clawList, setClawList] = useState<Claw[]>([]);
  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffTargetId, setHandoffTargetId] = useState<number | ''>('');
  const [handoffNote, setHandoffNote] = useState('');
  const [handing, setHanding] = useState(false);
  const [handoffResult, setHandoffResult] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    chatSessionsApi
      .list(clawId)
      .then(setSessions)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clawId]);

  const openSession = async (session: ChatSession) => {
    setSelectedSession(session);
    setMessages([]);
    setLoadingMsgs(true);
    setShowHandoff(false);
    setHandoffResult(null);
    setHandoffError(null);
    try {
      const msgs = await chatSessionsApi.getMessages(session.id);
      setMessages(msgs);
    } catch {
      // ignore
    } finally {
      setLoadingMsgs(false);
    }
    // Load other claws for handoff target selection
    claws.list().then((list) => setClawList(list.filter((c) => c.id !== clawId))).catch(() => {});
  };

  const handleHandoff = async () => {
    if (!selectedSession || !handoffTargetId) return;
    setHanding(true);
    setHandoffResult(null);
    setHandoffError(null);
    try {
      // Build context summary from messages
      const context = messages
        .slice(-20)
        .map((m) => `[${m.role}]: ${m.content.slice(0, 200)}`)
        .join('\n');
      await dispatchApi.send(Number(handoffTargetId), {
        type: 'session.handoff',
        sessionKey: selectedSession.sessionKey,
        sourceClawId: clawId,
        note: handoffNote.trim() || undefined,
        context,
      });
      setHandoffResult('Session handed off successfully.');
      setShowHandoff(false);
    } catch (e) {
      setHandoffError(e instanceof Error ? e.message : 'Handoff failed');
    } finally {
      setHanding(false);
    }
  };

  if (loading) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 4 }}>Loading sessions…</div>;
  }

  if (error) {
    return (
      <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>
        Error: {error}
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => { setSelectedSession(null); setMessages([]); }}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--bg-base)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {selectedSession.sessionKey}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {new Date(selectedSession.startedAt).toLocaleString()} · {selectedSession.msgCount} messages
            </div>
          </div>
          {clawList.length > 0 && (
            <button
              type="button"
              onClick={() => { setShowHandoff(!showHandoff); setHandoffError(null); setHandoffResult(null); }}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                background: showHandoff ? 'var(--bg-base)' : 'var(--surface-interactive)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Handoff →
            </button>
          )}
        </div>

        {handoffResult && (
          <div style={{ padding: '8px 12px', fontSize: 12, color: 'rgba(34,197,94,0.9)', background: 'rgba(34,197,94,0.08)', borderRadius: 8, border: '1px solid rgba(34,197,94,0.2)' }}>
            {handoffResult}
          </div>
        )}

        {showHandoff && (
          <div style={cardStyle}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Hand off to another claw</div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
              Send this session context to a target claw so it can resume the conversation. The last 20 messages will be included.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <select
                value={handoffTargetId}
                onChange={(e) => setHandoffTargetId(e.target.value ? Number(e.target.value) : '')}
                style={{
                  padding: '8px 10px',
                  fontSize: 13,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                }}
              >
                <option value="">Select target claw…</option>
                {clawList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.connectedAt ? ' ●' : ' ○'}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Handoff note (optional)"
                value={handoffNote}
                onChange={(e) => setHandoffNote(e.target.value)}
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                }}
              />
              {handoffError && (
                <div style={{ fontSize: 12, color: 'var(--coral-bright, #f4726e)' }}>{handoffError}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowHandoff(false)}
                  style={{ padding: '7px 14px', fontSize: 12, background: 'none', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleHandoff}
                  disabled={!handoffTargetId || handing}
                  style={{
                    padding: '7px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: handoffTargetId && !handing ? 'var(--coral-bright, #f4726e)' : 'var(--bg-elevated)',
                    color: handoffTargetId && !handing ? '#fff' : 'var(--text-muted)',
                    border: 'none',
                    borderRadius: 8,
                    cursor: !handoffTargetId || handing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {handing ? 'Handing off…' : 'Hand off'}
                </button>
              </div>
            </div>
          </div>
        )}

        {loadingMsgs ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 4 }}>Loading messages…</div>
        ) : messages.length === 0 ? (
          <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
            No messages found.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                    maxWidth: '90%',
                    padding: '8px 12px',
                    borderRadius: 10,
                    fontSize: 12,
                    lineHeight: 1.55,
                    background:
                      msg.role === 'user'
                        ? 'var(--surface-coral-soft, rgba(244,114,94,0.15))'
                        : 'var(--bg-base)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.content}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, paddingInline: 4 }}>
                  {msg.role} · {new Date(msg.createdAt).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
        Chat Sessions ({sessions.length})
      </div>
      {sessions.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          No sessions yet. Sessions are created when a claw starts a conversation.
        </div>
      ) : (
        sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            onClick={() => openSession(session)}
            style={{
              ...cardStyle,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              transition: 'background 0.1s',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {session.sessionKey}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {new Date(session.startedAt).toLocaleString()}
                {session.endedAt ? ` → ${new Date(session.endedAt).toLocaleString()}` : ' (active)'}
              </div>
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: 6,
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                flexShrink: 0,
              }}
            >
              {session.msgCount} msgs
            </div>
          </button>
        ))
      )}
    </div>
  );
}
