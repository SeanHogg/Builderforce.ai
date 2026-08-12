'use client';

/**
 * The message hub — the trigger beside the cart, and the conversation behind it.
 *
 * ── WHAT IT IS FOR ───────────────────────────────────────────────────────────
 * A sales associate needs to reach the person who runs the programme, and the
 * person who runs the programme needs to reach every associate who signed up.
 * Notifications are one-way and email is not real-time, so this is the two-way
 * channel: one or many conversations, live, from any page.
 *
 * ── WHY A PANEL AND NOT A WIDGET ─────────────────────────────────────────────
 * The app's convention reserves a centered modal for destructive approvals and
 * uses the slide-out for everything else, so this is a `SlideOutPanel`. It floats
 * because its STATE lives in the shell (`MessageHubContext`), not because it is
 * absolutely positioned — navigating with a conversation open keeps the
 * conversation open, which is the only sense in which "floats" is a requirement.
 *
 * ── LIVE ─────────────────────────────────────────────────────────────────────
 * Two rooms, both `{"type":"changed"}` signals over the shared relay: the
 * personal room (owned by the context, so the badge updates with nothing open)
 * and the open THREAD's room, here. No message body crosses a socket — the REST
 * route stays the source of truth and the panel re-fetches, which is the same
 * contract the board and Brain chats use.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Button } from '@/components/ui';
import { useRealtimeRoom } from '@/lib/embed/useRealtimeRoom';
import {
  messageThreadWsPath,
  messagesApi,
  type DirectMessage,
  type MessageThread,
} from '@/lib/messagesApi';
import { useOptionalMessageHub } from './MessageHubContext';

/** The other people in a thread — the name a list row shows. */
function otherNames(thread: MessageThread, meId: string | null): string {
  const others = thread.participants.filter((participant) => participant.userId !== meId);
  const list = others.length ? others : thread.participants;
  return list.map((participant) => participant.name || participant.email).join(', ');
}

export function MessageHubButton({ className }: { className?: string }) {
  const hub = useOptionalMessageHub();
  const t = useTranslations('messages');
  // Self-gating (the shared-component rule): a builder account with nobody to
  // message and no conversation gets no icon, rather than a caller having to
  // compute `isSales || isSuperadmin` at every mount point.
  if (!hub?.available) return null;

  return (
    <button
      type="button"
      className={className}
      onClick={hub.openHub}
      title={t('open')}
      aria-label={hub.unread > 0 ? t('openWithCount', { count: hub.unread }) : t('open')}
      style={{
        position: 'relative', background: 'none', border: 'none', color: 'var(--text-muted)',
        cursor: 'pointer', padding: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      {hub.unread > 0 && (
        <span style={{
          position: 'absolute', top: -1, right: -2, minWidth: 16, height: 16,
          borderRadius: 'var(--radius-full)', background: 'var(--coral-bright)',
          color: 'var(--text-on-accent)', fontSize: 'var(--font-size-field-label)',
          fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 3px', lineHeight: 1,
        }}>
          {hub.unread > 99 ? '99+' : hub.unread}
        </span>
      )}
    </button>
  );
}

export function MessageHubPanel({ meId }: { meId: string | null }) {
  const hub = useOptionalMessageHub();
  const t = useTranslations('messages');
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const contacts = hub?.contacts ?? [];
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const activeThreadId = hub?.activeThreadId ?? null;
  const open = hub?.open ?? false;

  const loadMessages = useCallback(() => {
    if (!activeThreadId) { setMessages([]); return; }
    messagesApi.messages(activeThreadId)
      .then((result) => setMessages(result.messages))
      .catch((cause) => setError(cause instanceof Error ? cause.message : ''));
  }, [activeThreadId]);

  useEffect(() => { if (open) loadMessages(); }, [loadMessages, open]);

  // Live for the OPEN conversation. The context owns the personal room; this owns
  // the thread room, so a reply appears without a poll and without re-subscribing
  // every render.
  useRealtimeRoom(open && activeThreadId ? messageThreadWsPath(activeThreadId) : null, () => {
    loadMessages();
    hub?.refresh();
  }, 'web');

  // Opening a conversation IS reading it.
  useEffect(() => {
    if (!open || !activeThreadId) return;
    void messagesApi.markRead(activeThreadId).then(() => hub?.refresh()).catch(() => undefined);
    // `hub` identity changes on every count update; re-marking on that would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, open, messages.length]);

  // A transcript reads downward, so a new message must not arrive off-screen.
  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  // `openWith(userId)` from another surface: resolve it to a thread once the hub
  // is open, reusing the conversation that already exists with that person.
  const pending = hub?.pendingContactId ?? null;
  useEffect(() => {
    if (!open || !pending || !hub) return;
    let cancelled = false;
    void (async () => {
      try {
        const thread = await messagesApi.open(pending);
        if (cancelled) return;
        hub.setActiveThreadId(thread.id);
        hub.refresh();
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t('openFailed'));
      } finally {
        if (!cancelled) hub.clearPendingContact();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending]);

  if (!hub) return null;

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeThreadId) return;
    setSending(true); setError('');
    try {
      await messagesApi.send(activeThreadId, body);
      setDraft('');
      loadMessages();
      hub.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sendFailed'));
    } finally {
      setSending(false);
    }
  };

  const startWith = async (userId: string) => {
    setError('');
    try {
      const thread = await messagesApi.open(userId);
      hub.setActiveThreadId(thread.id);
      hub.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('openFailed'));
    }
  };

  const active = hub.threads.find((thread) => thread.id === activeThreadId) ?? null;

  /** The conversation list, as the panel's index column. */
  const index = (
    <nav className="ui-index" data-orientation="vertical" aria-label={t('conversations')} style={{ minWidth: 190 }}>
      <span className="ui-index__group">{t('conversations')}</span>
      {hub.threads.map((thread) => (
        <button
          key={thread.id}
          type="button"
          className="ui-index__item"
          aria-current={thread.id === activeThreadId ? 'page' : undefined}
          onClick={() => hub.setActiveThreadId(thread.id)}
          style={{ cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {thread.subject || otherNames(thread, meId) || t('untitled')}
          </span>
          {thread.unread > 0 && (
            <span style={{
              background: 'var(--coral-bright)', color: 'var(--text-on-accent)', borderRadius: 'var(--radius-full)',
              fontSize: 'var(--font-size-field-label)', fontWeight: 700, padding: '1px 6px',
            }}>{thread.unread}</span>
          )}
        </button>
      ))}
      {contacts.length > 0 && <span className="ui-index__group">{t('startNew')}</span>}
      {contacts.map((contact) => (
        <button
          key={contact.userId}
          type="button"
          className="ui-index__item"
          onClick={() => void startWith(contact.userId)}
          style={{ cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {contact.name || contact.email}
          </span>
        </button>
      ))}
    </nav>
  );

  return (
    <SlideOutPanel
      open={open}
      onClose={hub.closeHub}
      width="wide"
      widthStorageKey="messages"
      crumb={t('crumb')}
      title={active ? (active.subject || otherNames(active, meId)) : t('title')}
      index={hub.threads.length > 0 || contacts.length > 0 ? index : undefined}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: 'var(--space-4)' }}>
        {error && <p role="alert" style={{ color: 'var(--coral-bright)', fontSize: 'var(--font-size-body)', margin: '0 0 10px' }}>{error}</p>}

        {!activeThreadId ? (
          <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            {contacts.length ? t('pickSomeone') : t('nobodyToMessage')}
          </p>
        ) : (
          <>
            <div ref={transcriptRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gap: 10, alignContent: 'start', paddingRight: 4 }}>
              {messages.length === 0 && (
                <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: 0 }}>{t('emptyThread')}</p>
              )}
              {messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    justifySelf: message.mine ? 'end' : 'start',
                    maxWidth: 'min(100%, 460px)',
                    background: message.mine ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '9px 12px',
                  }}
                >
                  <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginBottom: 3 }}>
                    {message.mine ? t('you') : (message.authorName || t('them'))} · {new Date(message.createdAtISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.5 }}>
                    {message.body}
                  </div>
                </div>
              ))}
            </div>

            <form
              onSubmit={(event) => { event.preventDefault(); void send(); }}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end', paddingTop: 12, marginTop: 12, borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}
            >
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends, Shift+Enter is a newline — the convention every
                  // chat surface in this product already uses.
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
                }}
                rows={2}
                placeholder={t('placeholder')}
                aria-label={t('placeholder')}
                style={{
                  flex: '1 1 220px', minWidth: 0, resize: 'vertical', padding: '9px 12px',
                  borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 'var(--font-size-body)', fontFamily: 'inherit',
                }}
              />
              <Button type="submit" variant="primary" loading={sending} disabled={!draft.trim()}>{t('send')}</Button>
            </form>
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}
