import { Icon } from '@/components/ui/Icon';
import { useEffect, useRef, useState } from 'react';
import { createSharedPoll, useSharedPoll } from '@/hooks/useSharedPoll';
import { useTranslations } from 'next-intl';
import { listConversations, type MessagingSide } from '@/lib/messagingApi';
import { MessagesPanel, type MessagesLaunchContext } from './MessagesPanel';

/**
 * The unread count, ONE poll per marketplace side shared by every button. The
 * inline variant renders on every row of a talent / engagement table, and each
 * instance used to poll the full conversation list itself — fifty rows were fifty
 * requests every thirty seconds. Now N buttons cost one request per tick, and
 * none while the tab is hidden.
 */
const unreadPoll = createSharedPoll<MessagingSide, number>({
  initial: 0,
  load: async (side) => (await listConversations(side)).unread,
  nextDelayMs: () => 30_000,
});

/**
 * Shared "Messages" launcher — the ONE entry point both marketplace sides use to open
 * the in-platform messaging drawer, with a live unread badge (one shared poll). Decides its own
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
  const { value: unread, refresh } = useSharedPoll(unreadPoll, side);

  // Re-check unread when the drawer closes (the user may have read threads) —
  // only after it was actually open, so mounting N rows does not fire N refreshes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) { wasOpen.current = true; return; }
    if (wasOpen.current) { wasOpen.current = false; refresh(); }
  }, [open, refresh]);

  const text = label ?? t('title');
  const badge = unread > 0 ? (
    <span style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, padding: '1px 7px', borderRadius: 'var(--radius-full)', background: variant === 'inline' ? 'var(--surface-coral-soft)' : 'color-mix(in srgb, var(--text-on-accent) 25%, transparent)', color: variant === 'inline' ? 'var(--coral-bright)' : 'var(--text-on-accent)' }}>{unread}</span>
  ) : null;

  return (
    <>
      {variant === 'inline' ? (
        <button type="button" onClick={() => setOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          
          <Icon source="💬" size="1em" /> {text} {badge}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)', fontWeight: 600, cursor: 'pointer' }}>
          
          <Icon source="💬" size="1em" /> {text} {badge}
        </button>
      )}
      <MessagesPanel open={open} onClose={() => setOpen(false)} side={side} context={open ? context : null} />
    </>
  );
}
