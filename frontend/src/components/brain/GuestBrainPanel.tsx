'use client';

/**
 * GuestBrainPanel — the Brain/Ideas chat for LOGGED-OUT visitors.
 *
 * A lean view over the SAME package conversation hooks the authed BrainPanel uses
 * (useBrainChats + useBrainConversation) — so the streaming/agent-loop logic is
 * shared, not duplicated — but wired to the GUEST runtime (guestBrainConfig):
 * a guest token on the transport and localStorage persistence. No tickets/agents/
 * uploads/MCP: a guest gets a clean "try the Brain" chat. When they exhaust the
 * tiny daily allowance we swap the composer for a "sign up free to keep going"
 * wall — the conversion moment. Signing up carries their lead over (same
 * visitorId, existing marketing convert flow).
 *
 * Rendered by ConditionalAppShell (the /brainstorm route + the floating drawer)
 * whenever `!hasTenant`, inside a BrainProvider configured with guestBrainConfig.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useBrainChats, useBrainConversation, isStepMessage } from '@/lib/brain';
import { ChatMessageContent } from '@/components/ChatMessageContent';
import { mintGuestSession, getGuestUsage } from '@/lib/guestChatApi';

interface GuestBrainPanelProps {
  variant: 'page' | 'docked';
  /** A one-shot prompt (e.g. from the homepage hero) auto-sent once ready. */
  initialPrompt?: string;
  /** Present in the docked drawer to close it. */
  onClose?: () => void;
}

export function GuestBrainPanel({ variant, initialPrompt, onClose }: GuestBrainPanelProps) {
  const t = useTranslations('guestBrain');

  const [ready, setReady] = useState(false);          // guest token minted
  const [enabled, setEnabled] = useState(true);       // kill switch / mint ok
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limit, setLimit] = useState(0);
  const [input, setInput] = useState('');

  const capReached = remaining !== null && remaining <= 0;

  const chats = useBrainChats({});
  const conv = useBrainConversation({
    chatId: chats.activeChatId,
    modality: 'llm',
    ensureChatId: async () => {
      const chat = await chats.create({ title: t('newChatTitle') });
      return chat?.id ?? null;
    },
    onActivity: (id) => { void chats.touch(id); },
  });

  // Mint the guest token on mount so the first send is authenticated. A null
  // result means guest chat is disabled or unreachable → show the sign-in CTA.
  useEffect(() => {
    let cancelled = false;
    void mintGuestSession().then((usage) => {
      if (cancelled) return;
      if (!usage) { setEnabled(false); setReady(true); return; }
      setRemaining(usage.remaining);
      setLimit(usage.limit);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Auto-send the one-shot initial prompt exactly once, after the token is ready.
  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (!ready || !enabled || capReached) return;
    if (sentInitialRef.current || !initialPrompt?.trim()) return;
    sentInitialRef.current = true;
    void doSend(initialPrompt.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, enabled, capReached, initialPrompt]);

  const refreshUsage = useCallback(async () => {
    const usage = await getGuestUsage();
    if (usage) { setRemaining(usage.remaining); setLimit(usage.limit); setEnabled(usage.enabled); }
  }, []);

  const doSend = useCallback(async (text: string) => {
    const ok = await conv.send(text);
    // Whether or not the model answered, the server consumed one message — refresh
    // the counter so the wall appears the instant the allowance is spent.
    void refreshUsage();
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv, refreshUsage]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || conv.sending || capReached) return;
    setInput('');
    const ok = await doSend(text);
    if (!ok) setInput(text); // restore on failure so nothing is lost
  };

  const isPage = variant === 'page';

  return (
    <div className={`gb-root ${isPage ? 'gb-page' : 'gb-docked'}`}>
      {/* Header */}
      <div className="gb-header">
        <span className="gb-brand">🧠 {t('brand')}</span>
        <div className="gb-header-right">
          <Link href="/register" className="gb-signup-link">{t('signUpFree')}</Link>
          {onClose && (
            <button type="button" onClick={onClose} aria-label={t('close')} className="gb-close">×</button>
          )}
        </div>
      </div>

      {/* Body */}
      {ready && !enabled ? (
        <GuestDisabledCTA t={t} />
      ) : (
        <>
          <div className="gb-messages">
            {conv.messages.length === 0 && !conv.streamingText && (
              <div className="gb-empty">
                <div className="gb-empty-emoji">💡</div>
                <div className="gb-empty-title">{t('emptyTitle')}</div>
                <div className="gb-empty-body">{t('emptyBody')}</div>
              </div>
            )}
            {conv.messages.filter((m) => !isStepMessage(m)).map((m) => (
              <div key={m.id} className={`gb-msg gb-msg-${m.role === 'user' ? 'user' : 'assistant'}`}>
                {m.role === 'user'
                  ? <div className="gb-bubble gb-bubble-user">{m.content}</div>
                  : <div className="gb-bubble gb-bubble-assistant"><ChatMessageContent content={m.content} /></div>}
              </div>
            ))}
            {conv.streamingText && (
              <div className="gb-msg gb-msg-assistant">
                <div className="gb-bubble gb-bubble-assistant"><ChatMessageContent content={conv.streamingText} /></div>
              </div>
            )}
            {conv.error && !capReached && <div className="gb-error">{conv.error}</div>}
          </div>

          {/* Composer OR the sign-up wall */}
          {capReached ? (
            <GuestCapWall t={t} limit={limit} />
          ) : (
            <form onSubmit={onSubmit} className="gb-composer">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onSubmit(e as unknown as React.FormEvent); } }}
                placeholder={ready ? t('placeholder') : t('loading')}
                disabled={!ready || conv.sending}
                rows={isPage ? 3 : 2}
                className="gb-textarea"
                aria-label={t('placeholder')}
              />
              <div className="gb-composer-row">
                <span className="gb-remaining">
                  {remaining !== null
                    ? t('remaining', { count: remaining })
                    : t('tagline')}
                </span>
                <button type="submit" disabled={!ready || conv.sending || !input.trim()} className="gb-send">
                  {conv.sending ? t('sending') : t('send')}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      <style>{`
        .gb-root { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg-base); color: var(--text-primary); }
        .gb-page { max-width: 820px; width: 100%; margin: 0 auto; height: calc(100vh - 120px); min-height: 480px; border: 1px solid var(--border-subtle); border-radius: 14px; overflow: hidden; }
        .gb-header { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-elevated); }
        .gb-brand { font-weight: 600; font-size: 15px; }
        .gb-header-right { display: flex; align-items: center; gap: 12px; }
        .gb-signup-link { font-size: 13px; font-weight: 600; color: var(--accent, #3b82f6); text-decoration: none; }
        .gb-close { background: transparent; border: none; color: var(--text-muted); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
        .gb-messages { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .gb-empty { margin: auto; text-align: center; max-width: 320px; display: flex; flex-direction: column; gap: 8px; color: var(--text-muted); }
        .gb-empty-emoji { font-size: 40px; }
        .gb-empty-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }
        .gb-empty-body { font-size: 14px; line-height: 1.5; }
        .gb-msg { display: flex; }
        .gb-msg-user { justify-content: flex-end; }
        .gb-msg-assistant { justify-content: flex-start; }
        .gb-bubble { max-width: 88%; padding: 10px 13px; border-radius: 12px; font-size: 14px; line-height: 1.55; overflow-wrap: anywhere; }
        .gb-bubble-user { background: var(--accent, #3b82f6); color: #fff; border-bottom-right-radius: 4px; }
        .gb-bubble-assistant { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-bottom-left-radius: 4px; }
        .gb-error { font-size: 13px; color: var(--danger, #dc2626); background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px 12px; }
        .gb-composer { flex-shrink: 0; border-top: 1px solid var(--border-subtle); padding: 10px 12px; background: var(--bg-elevated); }
        .gb-textarea { width: 100%; resize: none; border: 1px solid var(--border-subtle); border-radius: 10px; background: var(--bg-base); color: var(--text-primary); padding: 9px 11px; font-size: 14px; font-family: inherit; box-sizing: border-box; }
        .gb-textarea:disabled { opacity: 0.6; }
        .gb-composer-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
        .gb-remaining { font-size: 12px; color: var(--text-muted); }
        .gb-send { padding: 8px 18px; font-size: 14px; font-weight: 600; border: none; border-radius: 10px; background: var(--accent, #3b82f6); color: #fff; cursor: pointer; }
        .gb-send:disabled { opacity: 0.5; cursor: default; }
        @media (max-width: 640px) {
          .gb-page { height: calc(100vh - 80px); border-radius: 0; border-left: none; border-right: none; }
          .gb-bubble { max-width: 92%; }
        }
      `}</style>
    </div>
  );
}

/** The conversion wall shown once the guest's daily allowance is spent. */
function GuestCapWall({ t, limit }: { t: ReturnType<typeof useTranslations>; limit: number }) {
  return (
    <div className="gb-wall">
      <div className="gb-wall-emoji">🚀</div>
      <div className="gb-wall-title">{t('wallTitle')}</div>
      <div className="gb-wall-body">{t('wallBody', { count: limit })}</div>
      <div className="gb-wall-actions">
        <Link href="/register" className="gb-wall-primary">{t('createFreeAccount')}</Link>
        <Link href="/login" className="gb-wall-secondary">{t('signIn')}</Link>
      </div>
      <style>{`
        .gb-wall { flex-shrink: 0; border-top: 1px solid var(--border-subtle); padding: 20px 16px; background: var(--bg-elevated); text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .gb-wall-emoji { font-size: 32px; }
        .gb-wall-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
        .gb-wall-body { font-size: 13px; color: var(--text-muted); max-width: 340px; line-height: 1.5; }
        .gb-wall-actions { display: flex; gap: 10px; margin-top: 6px; flex-wrap: wrap; justify-content: center; }
        .gb-wall-primary { padding: 10px 20px; font-size: 14px; font-weight: 600; background: var(--accent, #3b82f6); color: #fff; border-radius: 10px; text-decoration: none; }
        .gb-wall-secondary { padding: 10px 20px; font-size: 14px; font-weight: 600; background: var(--bg-base); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 10px; text-decoration: none; }
      `}</style>
    </div>
  );
}

/** Shown when guest chat is disabled (kill switch) or unreachable. */
function GuestDisabledCTA({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="gb-disabled">
      <div className="gb-empty-emoji">🧠</div>
      <div className="gb-empty-title">{t('meetTitle')}</div>
      <div className="gb-empty-body">{t('meetBody')}</div>
      <div className="gb-wall-actions">
        <Link href="/register" className="gb-wall-primary">{t('createFreeAccount')}</Link>
        <Link href="/login" className="gb-wall-secondary">{t('signIn')}</Link>
      </div>
      <style>{`
        .gb-disabled { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center; color: var(--text-muted); }
        .gb-disabled .gb-empty-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }
        .gb-disabled .gb-empty-body { font-size: 14px; max-width: 300px; line-height: 1.5; }
        .gb-disabled .gb-wall-actions { display: flex; gap: 10px; margin-top: 8px; }
        .gb-disabled .gb-wall-primary { padding: 10px 20px; font-size: 14px; font-weight: 600; background: var(--accent, #3b82f6); color: #fff; border-radius: 10px; text-decoration: none; }
        .gb-disabled .gb-wall-secondary { padding: 10px 20px; font-size: 14px; font-weight: 600; background: var(--bg-base); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 10px; text-decoration: none; }
      `}</style>
    </div>
  );
}
