'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import {
  listConversations, getConversationThread, sendConversationMessage, markConversationRead,
  startEmployerConversation, startFreelancerConversation, fetchConversationAttachment,
  type ConversationSummary, type ConversationMessage, type MessagingSide,
} from '@/lib/freelancerApi';

/**
 * In-platform messaging drawer — employer<->freelancer threads. ONE component both
 * sides share (the `side` prop swaps the web/tenant token + endpoints); it decides its
 * own layout (list ↔ thread) and polls the open thread. Reachable from the freelancer
 * dashboard and every employer talent/engagement surface via a shared launcher.
 *
 * SlideOutPanel per the app convention (this is not a terminal destructive approval).
 */

export interface MessagesLaunchContext {
  /** Employer: open/start a thread with this freelancer (optionally scoped). */
  freelancerUserId?: string;
  /** Freelancer: open/start the engagement-scoped thread with this employer. */
  engagementId?: string;
  jobId?: string;
  proposalId?: string;
  title?: string;
}

const fmtTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export function MessagesPanel({ open, onClose, side, context }: {
  open: boolean;
  onClose: () => void;
  side: MessagingSide;
  context?: MessagesLaunchContext | null;
}) {
  const t = useTranslations('messaging');
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const refreshList = useCallback(async () => {
    try { const r = await listConversations(side); setItems(r.items); } catch { /* best-effort */ }
  }, [side]);

  const openThread = useCallback(async (id: string) => {
    setSelected(id);
    setLoading(true);
    setError(null);
    try {
      const r = await getConversationThread(side, id);
      setConversation(r.conversation);
      setMessages(r.messages);
      await markConversationRead(side, id).catch(() => {});
      setItems((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [side]);

  // On open: load the list, and honour a launch context (open or start the thread).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      await refreshList();
      if (!alive || !context) return;
      try {
        if (side === 'employer' && context.freelancerUserId) {
          const { id } = await startEmployerConversation({
            freelancerUserId: context.freelancerUserId,
            engagementId: context.engagementId, jobId: context.jobId, proposalId: context.proposalId, title: context.title,
          });
          await refreshList();
          if (alive) await openThread(id);
        } else if (side === 'freelancer' && context.engagementId) {
          const { id } = await startFreelancerConversation({ engagementId: context.engagementId, title: context.title });
          await refreshList();
          if (alive) await openThread(id);
        }
      } catch (e) { if (alive) setError((e as Error).message); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context, side]);

  // Poll the open thread + list every 5s while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      void refreshList();
      if (selected) {
        getConversationThread(side, selected).then((r) => {
          setMessages(r.messages);
          setConversation(r.conversation);
        }).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [open, selected, side, refreshList]);

  // Keep the thread pinned to the latest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    if (!selected || (!draft.trim() && !file) || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendConversationMessage(side, selected, { body: draft.trim(), file });
      setDraft('');
      setFile(null);
      const r = await getConversationThread(side, selected);
      setMessages(r.messages);
      void refreshList();
    } catch (e) { setError((e as Error).message); }
    finally { setSending(false); }
  };

  const openAttachment = async (m: ConversationMessage) => {
    try { const url = await fetchConversationAttachment(side, m.id); window.open(url, '_blank', 'noopener'); }
    catch (e) { setError((e as Error).message); }
  };

  const counterpartName = (c: ConversationSummary) =>
    side === 'employer' ? (c.freelancerName ?? t('aFreelancer')) : (c.tenantName ?? t('aClient'));
  // "From the freelancer" bubbles sit on the freelancer's own side; the viewer's own
  // messages align right regardless of side.
  const isMine = (m: ConversationMessage) => (side === 'freelancer' ? m.fromFreelancer : !m.fromFreelancer);

  const bubble = (mine: boolean): React.CSSProperties => ({
    maxWidth: '80%', padding: '8px 12px', borderRadius: 12, fontSize: 14, lineHeight: 1.4,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    alignSelf: mine ? 'flex-end' : 'flex-start',
    background: mine ? 'var(--coral-bright, #f4726e)' : 'var(--bg-elevated)',
    color: mine ? '#fff' : 'var(--text-primary)',
    border: mine ? 'none' : '1px solid var(--border-subtle)',
  });

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={selected ? (
        <button type="button" onClick={() => { setSelected(null); setConversation(null); setMessages([]); }}
          style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 700, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8, padding: 0 }}>
          <span aria-hidden>‹</span>{conversation ? counterpartName(conversation) : t('title')}
        </button>
      ) : t('title')}
      width="min(520px, 96vw)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {error && <div style={{ color: 'var(--danger, #e5484d)', fontSize: 12, padding: '8px 16px' }}>{error}</div>}

        {/* Conversation list */}
        {!selected && (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 24, textAlign: 'center' }}>{t('empty')}</div>
            ) : items.map((c) => (
              <button key={c.id} type="button" onClick={() => void openThread(c.id)}
                style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-subtle)', background: c.unread > 0 ? 'var(--bg-elevated)' : 'transparent', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{counterpartName(c)}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtTime(c.lastMessageAt)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.title ? `${c.title} · ` : ''}{c.lastMessagePreview ?? t('noMessages')}
                  </span>
                  {c.unread > 0 && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: 'var(--surface-coral-soft)', color: 'var(--coral-bright)' }}>{c.unread}</span>}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Thread */}
        {selected && (
          <>
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
              {loading && messages.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</div>
              ) : messages.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginTop: 24 }}>{t('startThread')}</div>
              ) : messages.map((m) => {
                const mine = isMine(m);
                return (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}>
                    <div style={bubble(mine)}>
                      {m.body && <div>{m.body}</div>}
                      {m.hasAttachment && (
                        <button type="button" onClick={() => void openAttachment(m)}
                          style={{ marginTop: m.body ? 6 : 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, background: mine ? 'rgba(255,255,255,0.2)' : 'var(--bg-base)', color: mine ? '#fff' : 'var(--coral-bright)', border: 'none', borderRadius: 8, padding: '4px 8px', cursor: 'pointer' }}>
                          📎 {m.attachmentName ?? t('attachment')}
                        </button>
                      )}
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.senderName ? `${m.senderName} · ` : ''}{fmtTime(m.createdAt)}</span>
                  </div>
                );
              })}
            </div>

            {/* Composer */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', padding: 12, flexShrink: 0 }}>
              {file && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  📎 {file.name}
                  <button type="button" onClick={() => setFile(null)} style={{ background: 'none', border: 'none', color: 'var(--danger, #e5484d)', cursor: 'pointer', fontSize: 12 }}>{t('remove')}</button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <label style={{ flexShrink: 0, cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', padding: '6px 4px' }} title={t('attach')}>
                  📎
                  <input type="file" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
                  placeholder={t('placeholder')}
                  rows={2}
                  style={{ flex: 1, resize: 'none', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'inherit' }}
                />
                <button type="button" onClick={() => void send()} disabled={sending || (!draft.trim() && !file)}
                  style={{ flexShrink: 0, padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--coral-bright, #f4726e)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: sending ? 'wait' : 'pointer', opacity: (!draft.trim() && !file) ? 0.5 : 1 }}>
                  {sending ? t('sending') : t('send')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}
