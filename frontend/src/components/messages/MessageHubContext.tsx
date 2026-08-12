'use client';

/**
 * The message hub's STATE — mounted once in the shell, so it floats.
 *
 * "Floats from page to page" is not a visual effect, it is a mounting decision:
 * the trigger, the panel and the unread count live in the app shell, above the
 * router's page slot, so navigating does not unmount an open conversation or
 * reset the badge. Anything that wanted to open it from a page (the admin sales
 * view's "Message Ada") therefore has to ask the shell rather than render its own
 * copy — which is what `openWith` is for, and why this is a context and not a
 * component with local state.
 *
 * The unread count is kept HERE rather than inside the button, because two things
 * read it (the button's badge, and the panel deciding what to mark read) and a
 * count fetched twice is a count that disagrees with itself.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRealtimeRoom } from '@/lib/embed/useRealtimeRoom';
import { MESSAGE_INBOX_WS_PATH, messagesApi, type MessageParticipant, type MessageThread } from '@/lib/messagesApi';
import { getStoredWebToken } from '@/lib/auth';

interface MessageHubValue {
  /** Who this account may start a conversation with. Loaded once, in the
   *  provider, because the TRIGGER needs it to self-gate — a message icon with
   *  nobody behind it is a door into an empty room. */
  contacts: MessageParticipant[];
  /** False when there is no conversation and nobody to start one with. */
  available: boolean;
  open: boolean;
  openHub: () => void;
  closeHub: () => void;
  /** Open the hub on a conversation with this person, starting one if needed. */
  openWith: (userId: string) => void;
  threads: MessageThread[];
  unread: number;
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  refresh: () => void;
  /** Set while `openWith` is resolving, so the panel can show the right thread. */
  pendingContactId: string | null;
  clearPendingContact: () => void;
}

const MessageHubContext = createContext<MessageHubValue | null>(null);

export function MessageHubProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [unread, setUnread] = useState(0);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [pendingContactId, setPendingContactId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<MessageParticipant[]>([]);

  const refresh = useCallback(() => {
    // No token means signed out — the hub renders nothing and must not poll an
    // endpoint that will 401 on every navigation.
    if (!getStoredWebToken()) { setThreads([]); setUnread(0); return; }
    messagesApi.threads()
      .then((result) => { setThreads(result.threads); setUnread(result.unread); })
      .catch(() => { /* the badge is additive; a failure must not break the shell */ });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!getStoredWebToken()) { setContacts([]); return; }
    messagesApi.contacts().then((result) => setContacts(result.contacts)).catch(() => setContacts([]));
  }, []);

  // Server push instead of polling: the personal room reports any change to any
  // conversation this person is in, so the badge lights up with nothing open.
  useRealtimeRoom(getStoredWebToken() ? MESSAGE_INBOX_WS_PATH : null, refresh, 'web');

  const openWith = useCallback((userId: string) => {
    setPendingContactId(userId);
    setOpen(true);
  }, []);

  const value = useMemo<MessageHubValue>(() => ({
    contacts,
    available: contacts.length > 0 || threads.length > 0,
    open,
    openHub: () => setOpen(true),
    closeHub: () => setOpen(false),
    openWith,
    threads,
    unread,
    activeThreadId,
    setActiveThreadId,
    refresh,
    pendingContactId,
    clearPendingContact: () => setPendingContactId(null),
  }), [activeThreadId, contacts, open, openWith, pendingContactId, refresh, threads, unread]);

  return <MessageHubContext.Provider value={value}>{children}</MessageHubContext.Provider>;
}

/**
 * Read the hub. Throws OUTSIDE the provider on purpose: a component that opens a
 * conversation is useless if its click silently does nothing, and a no-op default
 * is exactly how that ships unnoticed.
 */
export function useMessageHub(): MessageHubValue {
  const context = useContext(MessageHubContext);
  if (!context) throw new Error('useMessageHub must be used within a MessageHubProvider');
  return context;
}

/** The optional read, for chrome that renders in both shells. */
export function useOptionalMessageHub(): MessageHubValue | null {
  return useContext(MessageHubContext);
}
