'use client';

import { Select } from '@/components/Select';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { chatSessionsApi, agentHosts, dispatchApi, type ChatSession, type ChatMessage, type AgentHost } from '@/lib/builderforceApi';
import { useFormat } from "@/i18n/useFormat";
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { usePanelTask } from '@/hooks/usePanelTask';

interface AgentHostSessionsContentProps {
  agentHostId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

export function AgentHostSessionsContent({ agentHostId }: AgentHostSessionsContentProps) {
  const errorMessage = useErrorMessage();
  const tc = useTranslations('common');
  const t = useTranslations('agentHostTabs');
  const fmt = useFormat();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  // Handoff state
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffTargetId, setHandoffTargetId] = useState<number | ''>('');
  const [handoffNote, setHandoffNote] = useState('');
  const handoff = usePanelTask();

  useEffect(() => {
    setLoading(true);
    setError(null);
    chatSessionsApi
      .list(agentHostId)
      .then(setSessions)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [agentHostId, errorMessage]);

  const openSession = async (session: ChatSession) => {
    setSelectedSession(session);
    setMessages([]);
    setLoadingMsgs(true);
    setShowHandoff(false);
    handoff.clear();
    try {
      const msgs = await chatSessionsApi.getMessages(session.id);
      setMessages(msgs);
    } catch {
      // ignore
    } finally {
      setLoadingMsgs(false);
    }
    // Load other agentHosts for handoff target selection
    agentHosts.list().then((list) => setAgentHostList(list.filter((c) => c.id !== agentHostId))).catch(() => {});
  };

  const handleHandoff = async () => {
    if (!selectedSession || !handoffTargetId) return;
    // Build context summary from messages — sent to the TARGET agent, not shown to a person.
    const context = messages
      .slice(-20)
      .map((m) => `[${m.role}]: ${m.content.slice(0, 200)}`)
      .join('\n');
    const sent = await handoff.run(() => dispatchApi.send(Number(handoffTargetId), {
      type: 'session.handoff',
      sessionKey: selectedSession.sessionKey,
      sourceAgentHostId: agentHostId,
      note: handoffNote.trim() || undefined,
      context,
    }), { success: t('sessions.handoffSuccess') });
    if (sent) setShowHandoff(false);
  };

  if (loading) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 4 }}>{t('sessions.loading')}</div>;
  }

  if (error) {
    return (
      <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>
        {t('errorPrefix', { message: error })}
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
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            {t('back')}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
              {selectedSession.sessionKey}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {fmt.dateTime(selectedSession.startedAt)} · {t('sessions.messageCount', { count: selectedSession.msgCount })}
            </div>
          </div>
          {agentHostList.length > 0 && (
            <button
              type="button"
              onClick={() => { setShowHandoff(!showHandoff); handoff.clear(); }}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                background: showHandoff ? 'var(--bg-base)' : 'var(--surface-interactive)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {t('sessions.handoff')}
            </button>
          )}
        </div>

        {handoff.notice && (
          <div role="status" style={{ padding: '8px 12px', fontSize: 12, color: 'var(--success-text)', background: 'var(--success-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--success-border)' }}>
            {handoff.notice}
          </div>
        )}

        {showHandoff && (
          <div style={cardStyle}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{t('sessions.handoffTitle')}</div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
              {t('sessions.handoffBody')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Select
                value={handoffTargetId}
                onChange={(e) => setHandoffTargetId(e.target.value ? Number(e.target.value) : '')}
                style={{
                  padding: '8px 10px',
                  fontSize: 13,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <option value="">{t('sessions.selectTarget')}</option>
                {agentHostList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.online ? ' ●' : ' ○'}
                  </option>
                ))}
              </Select>
              <input
                type="text"
                placeholder={t('sessions.notePlaceholder')}
                value={handoffNote}
                onChange={(e) => setHandoffNote(e.target.value)}
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                }}
              />
              {handoff.error && (
                <div style={{ fontSize: 12, color: 'var(--coral-bright)' }}>{handoff.error}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowHandoff(false)}
                  style={{ padding: '7px 14px', fontSize: 12, background: 'none', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}
                >
                  {tc('cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleHandoff}
                  disabled={!handoffTargetId || handoff.busy}
                  style={{
                    padding: '7px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: handoffTargetId && !handoff.busy ? 'var(--coral-bright)' : 'var(--bg-elevated)',
                    color: handoffTargetId && !handoff.busy ? 'var(--text-on-accent)' : 'var(--text-muted)',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    cursor: !handoffTargetId || handoff.busy ? 'not-allowed' : 'pointer',
                  }}
                >
                  {handoff.busy ? t('sessions.handingOff') : t('sessions.handOff')}
                </button>
              </div>
            </div>
          </div>
        )}

        {loadingMsgs ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 4 }}>{t('sessions.loadingMessages')}</div>
        ) : messages.length === 0 ? (
          <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
            {t('sessions.noMessages')}
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
                    borderRadius: 'var(--radius-lg)',
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
                  {t('sessions.role', { role: msg.role })} · {fmt.time(msg.createdAt)}
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
        {t('sessions.heading', { count: sessions.length })}
      </div>
      {sessions.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          {t('sessions.empty')}
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
                {fmt.dateTime(session.startedAt)}
                {session.endedAt ? ` → ${fmt.dateTime(session.endedAt)}` : ` ${t('sessions.active')}`}
              </div>
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                flexShrink: 0,
              }}
            >
              {t('sessions.msgCount', { count: session.msgCount })}
            </div>
          </button>
        ))
      )}
    </div>
  );
}
