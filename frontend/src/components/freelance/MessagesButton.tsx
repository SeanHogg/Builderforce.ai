'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { listConversations, type MessagingSide } from '@/lib/freelancerApi';
import { MessagesPanel, type MessagesLaunchContext } from './MessagesPanel';

/**
 * Shared "Messages" launcher — the ONE entry point both marketplace sides use to open
 * the in-platform messaging drawer, with a live unread badge (polled). Decides its own
 * unread state so callers never prop-drill a count. Pass `context` to open/start a
 * specific thread (e.g. from an engagement row or a talent card).
 *
 *  - variant="button"  → a labelled button (dashboards, headers)
 *  - variant="inline"  → a compact text action (table/list rows)
 */
export function MessagesButton({ side, context, variant = 'button', label }: {
  side: MessagingSide;
  context?: MessagesLaunchContext | null;
  variant?: 'button' | 'inline';
  label?: string;
}) {
  const t = useTranslations('messaging');
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try { const r = await listConversations(side); setUnread(r.unread); } catch { /* best-effort */ }
  }, [side]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Re-check unread whenever the drawer closes (the user may have read threads).
  useEffect(() => { if (!open) void refresh(); }, [open, refresh]);

  const text = label ?? t('title');
  const badge = unread > 0 ? (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: variant === 'inline' ? 'var(--surface-coral-soft)' : 'rgba(255,255,255,0.25)', color: variant === 'inline' ? 'var(--coral-bright)' : '#fff' }}>{unread}</span>
  ) : null;

  return (
    <>
      {variant === 'inline' ? (
        <button type="button" onClick={() => setOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--coral-bright, #f4726e)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          💬 {text} {badge}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          💬 {text} {badge}
        </button>
      )}
      <MessagesPanel open={open} onClose={() => setOpen(false)} side={side} context={open ? context : null} />
    </>
  );
}
