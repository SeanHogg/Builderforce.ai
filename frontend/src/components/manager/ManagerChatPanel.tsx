'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { ChatMessageContent } from '@/components/ChatMessageContent';
import {
  managerApi, brain,
  type ManagerChatHandle, type BrainMessage,
} from '@/lib/builderforceApi';

/**
 * ASK THE MANAGER — the conversation where a person holds the AI Manager to account.
 *
 * ── WHY A CHAT AND NOT MORE DASHBOARD ────────────────────────────────────────────
 * The Manager page could already show what the manager DID (the decision feed), what
 * is STUCK (the register and census) and what got done TODAY (the digest). What it
 * could not do is take the question those numbers actually provoke — "so why didn't
 * you get anything done?" — because that question has no fixed shape. It is different
 * every day, it drills in, and it deserves an answer that reasons over the record
 * rather than another chart.
 *
 * ── IT IS AN ORDINARY BRAIN CHAT ─────────────────────────────────────────────────
 * The transcript, the reply loop, the tool execution and the markdown rendering all
 * come from the existing chat stack: this panel resolves WHICH chat (one per project,
 * `origin='manager'`) and WHO answers, then drives `brain.sendMessages` +
 * `brain.requestAgentReply` — the same two calls any @agent mention makes. Building a
 * second messaging surface here would have meant a second transcript and a second reply
 * loop to keep in step with the first.
 *
 * ── THE PROMPTS ARE THE POINT ────────────────────────────────────────────────────
 * The three starters are not decoration. They are the questions a manager is actually
 * accountable for, phrased so the answer must be specific, and having them one click
 * away is what makes the difference between a chat box people ignore and a habit. The
 * manager answers them by reading its own record (manager.digest / .decisions /
 * .census / .policy) — so "nothing shipped" comes back with the gate that held it.
 *
 * Fully localized, themed for light + dark via CSS variables, and responsive.
 */

const panelStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};
const sectionTitleStyle: CSSProperties = { fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' };
const mutedStyle: CSSProperties = { color: 'var(--text-muted)', fontSize: '0.8rem' };

/** The accountability questions, as i18n keys under `manager.ask.starter`. */
const STARTERS = ['today', 'blocked', 'plan'] as const;

/** Read the agent display name a reply was attributed with (`metadata.authoredBy`). */
function authorOf(message: BrainMessage, fallback: string): string {
  if (!message.metadata) return fallback;
  try {
    const parsed = JSON.parse(message.metadata) as { authoredBy?: { name?: string } };
    return parsed.authoredBy?.name || fallback;
  } catch {
    return fallback;
  }
}

export interface ManagerChatPanelProps {
  projectId: number;
  /** Compact mode: the starter row only, for embedding under the Today digest. The
   *  full transcript lives on the Ask sub-tab; a starter click deep-links to it. */
  compact?: boolean;
  /** Called with the chosen starter's text when `compact` — the host navigates. */
  onAsk?: (question: string) => void;
  /**
   * A question to ask ONCE as soon as the chat resolves — how a starter clicked beside
   * the Today numbers arrives here after the navigation. Routing stays with the host so
   * this component carries no URL knowledge.
   */
  initialQuestion?: string | null;
}

export function ManagerChatPanel({ projectId, compact = false, onAsk, initialQuestion }: ManagerChatPanelProps) {
  const t = useTranslations('manager.ask');
  const format = useFormatter();

  const [handle, setHandle] = useState<ManagerChatHandle | null>(null);
  const [messages, setMessages] = useState<BrainMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const h = await managerApi.chat(projectId);
      setHandle(h);
      // Compact mode renders starters only — skip the transcript fetch entirely rather
      // than loading a conversation it will not show.
      if (!compact) setMessages(await brain.getMessages(h.chatId, 60));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setLoading(false);
    }
  }, [projectId, compact, t]);

  useEffect(() => { void load(); }, [load]);

  // Keep the newest turn in view as the conversation grows — but never on the first
  // paint of a page the user is reading from the top.
  const hasMessages = messages.length > 0;
  useEffect(() => {
    if (!compact && hasMessages) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [compact, hasMessages, thinking]);

  const ask = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text || !handle || thinking) return;
    // No agent resolved ⇒ nobody can answer. Posting the question anyway would leave it
    // sitting unanswered forever, which reads as the manager ignoring it.
    if (!handle.agentRef) return;

    setDraft('');
    setThinking(true);
    setError(null);
    try {
      // The question is ADDRESSED to the manager — the same `addressedTo` convention an
      // @agent mention uses, so the transcript records who it was put to.
      const posted = await brain.sendMessages(handle.chatId, [{
        role: 'user',
        content: text,
        metadata: JSON.stringify({ addressedTo: { kind: 'agent', ref: handle.agentRef, name: handle.agentName } }),
      }]);
      setMessages((prev) => [...prev, ...posted]);
      const reply = await brain.requestAgentReply(handle.chatId, {
        agentRef: handle.agentRef,
        ...(handle.agentName ? { agentName: handle.agentName } : {}),
      });
      setMessages((prev) => [...prev, reply]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
      // Re-read rather than trusting the optimistic append: the question may well have
      // persisted even though the reply failed, and dropping it would show the user a
      // conversation that lost their message.
      if (handle) await brain.getMessages(handle.chatId, 60).then(setMessages).catch(() => undefined);
    } finally {
      setThinking(false);
    }
  }, [handle, thinking, t]);

  // Fire the handed-in question exactly once, after the chat + its agent resolve. The
  // ref (not state) is what makes it once: `ask` is re-created on every state change it
  // touches, so an effect keyed on it alone would re-ask on the reply it just produced.
  const askedInitial = useRef(false);
  useEffect(() => {
    if (compact || askedInitial.current || !initialQuestion?.trim() || !handle?.agentRef) return;
    askedInitial.current = true;
    void ask(initialQuestion);
  }, [compact, initialQuestion, handle, ask]);

  const starterRow = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {STARTERS.map((key) => {
        const question = t(`starter.${key}`);
        return (
          <button
            key={key}
            type="button"
            disabled={thinking || (!compact && !handle?.agentRef)}
            onClick={() => (compact && onAsk ? onAsk(question) : void ask(question))}
            style={{
              padding: '6px 12px', borderRadius: 999, cursor: thinking ? 'default' : 'pointer',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
              color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 600,
              opacity: thinking ? 0.6 : 1, textAlign: 'left', maxWidth: '100%',
            }}
          >
            {question}
          </button>
        );
      })}
    </div>
  );

  // ── Compact: the ask affordance where the numbers are ──
  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={mutedStyle}>{t('compactPrompt', { name: handle?.agentName ?? t('fallbackName') })}</div>
        {starterRow}
      </div>
    );
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden>🧭</span>
        <span style={sectionTitleStyle}>{t('title')}</span>
      </div>
      {handle?.agentName && (
        <span style={mutedStyle}>
          {handle.designated ? t('answeredByDesignated', { name: handle.agentName }) : t('answeredBy', { name: handle.agentName })}
        </span>
      )}
    </div>
  );

  if (loading && !handle) {
    return <section style={panelStyle}>{header}<div style={{ ...mutedStyle, marginTop: 12 }}>{t('loading')}</div></section>;
  }

  return (
    <section style={panelStyle}>
      {header}
      <p style={{ ...mutedStyle, margin: '6px 0 0' }}>{t('caption')}</p>

      {/* No agent at all — say so instead of offering an input that cannot be answered. */}
      {handle && !handle.agentRef && (
        <div
          role="alert"
          style={{
            marginTop: 12, padding: 12, borderRadius: 10, fontSize: '0.85rem',
            border: '1px solid var(--warning-border, var(--border-subtle))',
            borderLeft: '3px solid var(--warning-text, #b45309)',
            background: 'var(--bg-base)', color: 'var(--text-primary)',
          }}
        >
          {t('noAgent')}
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 ? (
          <p style={{ ...mutedStyle, margin: 0 }}>{t('empty')}</p>
        ) : (
          messages.map((m) => {
            const mine = m.role === 'user';
            return (
              <article
                key={m.id}
                style={{
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                  maxWidth: 'min(680px, 100%)',
                  background: mine ? 'var(--accent, #2563eb)' : 'var(--bg-base)',
                  color: mine ? '#fff' : 'var(--text-primary)',
                  border: mine ? 'none' : '1px solid var(--border-subtle)',
                  borderRadius: 12, padding: '10px 13px', minWidth: 0,
                }}
              >
                <div style={{
                  fontSize: '0.7rem', fontWeight: 700, marginBottom: 4,
                  color: mine ? 'rgba(255,255,255,0.85)' : 'var(--text-secondary)',
                }}>
                  {mine ? t('you') : authorOf(m, handle?.agentName ?? t('fallbackName'))}
                  {' · '}
                  {format.dateTime(new Date(m.createdAt), { hour: 'numeric', minute: '2-digit' })}
                </div>
                {/* The manager answers in markdown (numbers, ticket lists, tables) — rendered
                    through the SAME renderer every other chat surface uses. */}
                <div style={{ fontSize: '0.88rem', lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                  <ChatMessageContent content={m.content} />
                </div>
              </article>
            );
          })
        )}
        {thinking && (
          <div style={{ ...mutedStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              aria-hidden
              style={{
                width: 8, height: 8, borderRadius: '50%',
                background: 'var(--accent, #2563eb)', animation: 'bf-pulse 1.2s ease-in-out infinite',
              }}
            />
            {t('thinking', { name: handle?.agentName ?? t('fallbackName') })}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div style={{ marginTop: 10, fontSize: '0.82rem', color: 'var(--danger-text, #b91c1c)' }}>{error}</div>
      )}

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {starterRow}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — the convention every other
              // composer in the product uses.
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(draft); }
            }}
            placeholder={t('placeholder')}
            rows={2}
            disabled={!handle?.agentRef}
            style={{
              flex: '1 1 240px', minWidth: 0, resize: 'vertical', fontFamily: 'inherit',
              padding: '9px 11px', borderRadius: 10, fontSize: '0.87rem',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)',
            }}
          />
          <button
            type="button"
            disabled={thinking || !draft.trim() || !handle?.agentRef}
            onClick={() => void ask(draft)}
            style={{
              padding: '10px 18px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: '0.85rem',
              background: 'var(--accent, #2563eb)', color: '#fff',
              cursor: thinking || !draft.trim() ? 'default' : 'pointer',
              opacity: thinking || !draft.trim() || !handle?.agentRef ? 0.6 : 1,
            }}
          >
            {thinking ? t('sending') : t('send')}
          </button>
        </div>
      </div>
    </section>
  );
}
