'use client';

import { useCallback, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { chatSessionsApi, type ChatSession, type ChatMessage } from '@/lib/builderforceApi';
import { useFormat } from "@/i18n/useFormat";
import { useErrorMessage } from '@/i18n/useErrorMessage';

type SessionWithName = ChatSession & { agentHostName?: string };

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

/**
 * All chat sessions across agentHosts in the workspace, with a session list and
 * message thread viewer. Layout-only (no PageContainer/header) so it can be
 * dropped into the Workforce tab strip or any other shell.
 */
export function ChatsView() {
  const t = useTranslations('chatsView');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const fmt = useFormat();
  const [sessions, setSessions] = useState<SessionWithName[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SessionWithName | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    chatSessionsApi.listAll(100)
      .then(setSessions)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [errorMessage]);

  useEffect(() => { load(); }, [load]);

  const hostName = (s: SessionWithName) => s.agentHostName ?? t('hostFallback', { id: String(s.agentHostId) });

  const selectSession = async (s: SessionWithName) => {
    setSelected(s);
    setMessages([]);
    setLoadingMsgs(true);
    try {
      setMessages(await chatSessionsApi.getMessages(s.id, 200));
    } catch (e) {
      // A failed thread read says so, rather than leaving "No messages." standing in for it.
      setError(errorMessage(e));
    } finally {
      setLoadingMsgs(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {t('intro')}
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          style={{
            padding: '7px 14px', fontSize: 13, fontWeight: 600,
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer', flexShrink: 0,
          }}
        >
          {loading ? tc('loading') : tc('refresh')}
        </button>
      </div>

      {error && (
        <div role="alert" style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>
          {t('errorPrefix', { error })}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loadingSessions')}</div>
      ) : sessions.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
          {t('empty')}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 16, height: 'clamp(420px, calc(100dvh - 280px), 760px)' }}>
          {/* Session list */}
          <div style={{ ...cardStyle, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {t('sessionsHeading', { count: sessions.length })}
            </div>
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void selectSession(s)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  padding: '8px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left', width: '100%',
                  background: selected?.id === s.id ? 'var(--surface-interactive)' : 'transparent',
                  border: `1px solid ${selected?.id === s.id ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
                }}
              >
                <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                    {s.sessionKey}
                  </span>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', color: 'var(--text-muted)', flexShrink: 0 }}>
                    {t('messageCount', { count: s.msgCount })}
                  </span>
                </div>
                <div style={{ display: 'flex', width: '100%', gap: 4, marginTop: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hostName(s)}
                  </span>
                  <span>{s.lastMsgAt ? fmt.dateTime(s.lastMsgAt) : '—'}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Message thread */}
          <div style={{ ...cardStyle, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {!selected ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: 'auto' }}>
                {t('selectPrompt')}
              </div>
            ) : (
              <>
                <div style={{ flexShrink: 0, marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{selected.sessionKey}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                    {hostName(selected)} · {selected.startedAt ? fmt.dateTime(selected.startedAt) : '—'}
                  </span>
                </div>
                <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {loadingMsgs ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loadingMessages')}</div>
                  ) : messages.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noMessages')}</div>
                  ) : (
                    messages.map((m) => (
                      <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: m.role === 'user' ? 'var(--cyan-bright)' : 'var(--text-muted)', textTransform: 'uppercase' }}>
                          {m.role}
                        </div>
                        <div style={{
                          fontSize: 13, color: 'var(--text-primary)',
                          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', padding: '8px 12px',
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
