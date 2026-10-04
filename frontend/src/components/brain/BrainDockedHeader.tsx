import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BrainMark } from './BrainMark';
import { UnreadBadge } from '@/components/UnreadBadge';

export type BrainDockedTab = 'chat' | 'history';

/** Docked sections. Order is the tab order. */
const TABS = [
  { id: 'chat', labelKey: 'tabChat' },
  { id: 'history', labelKey: 'tabHistory' },
] as const;

export interface BrainDockedHeaderProps {
  tab: BrainDockedTab;
  onTabChange: (tab: BrainDockedTab) => void;
  /** Unread messages in chats other than the open one — badged on History. */
  historyUnread: number;
  onNewChat: () => void;
  /** Where "expand" goes: the full Brain page, carrying the open chat. */
  expandHref: string;
  /** Drawer only. An inline (page-docked) Brain has nothing to close. */
  onClose?: () => void;
  /** Extra icon actions owned by the panel (e.g. "capture execution"). */
  actions?: React.ReactNode;
  /** What the agent currently sees, supplied by the host (open file, voice, …). */
  context?: React.ReactNode;
}

/**
 * The docked Brain's chrome, in ONE row: the mark, the Chat | History switch, and the
 * icon actions. It used to be three stacked bands — a title bar with text buttons, a
 * full-width tab strip, and (in the Studio) a context strip above both — which in a
 * ~340px column spent ~130px before the first word of the conversation. The host's
 * context line now sits inside the chrome as a subtitle instead of floating over it.
 *
 * Responsive: the row wraps rather than overflowing, so at 360px the actions drop
 * under the tabs instead of clipping. Theme tokens throughout.
 */
export function BrainDockedHeader({ tab, onTabChange, historyUnread, onNewChat, expandHref, onClose, actions, context }: BrainDockedHeaderProps) {
  const t = useTranslations('brain');

  return (
    <header style={{ flexShrink: 0, padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'var(--font-size-body)', color: 'var(--text-primary)' }}>
          <BrainMark /> {t('brainTitle')}
        </span>
        <div
          role="tablist"
          aria-label={t('sectionsAria')}
          style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 'var(--radius-full)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)' }}
        >
          {TABS.map(({ id, labelKey }) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`brain-tab-${id}`}
                aria-selected={selected}
                aria-controls={`brain-tabpanel-${id}`}
                onClick={() => onTabChange(id)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  height: 26, padding: '0 12px', borderRadius: 'var(--radius-full)', border: 'none', cursor: 'pointer',
                  fontSize: 'var(--font-size-small)', fontWeight: 600,
                  background: selected ? 'var(--accent)' : 'transparent',
                  color: selected ? 'var(--text-on-accent)' : 'var(--text-muted)',
                }}
              >
                {t(labelKey)}
                {/* History carries the "something is waiting in another chat" signal,
                    so switching tabs is worth doing rather than guessing. */}
                {id === 'history' && <UnreadBadge count={historyUnread} size={16} />}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {actions}
          <IconButton label={t('newChat')} onClick={onNewChat} glyph="+" />
          {/* Expand → the full Brain page, on the SAME conversation (the href carries
              the open chat), so expanding never reads as the chat being lost. */}
          <Link href={expandHref} title={t('openFullBrainStorm')} aria-label={t('openFullBrainStorm')} style={iconButtonStyle}>
            <span aria-hidden>↗</span>
          </Link>
          {onClose && <IconButton label={t('closeBrain')} onClick={onClose} glyph="×" />}
        </div>
      </div>
      {context && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
          {context}
        </div>
      )}
    </header>
  );
}

const iconButtonStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, padding: 0, borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
  color: 'var(--text-secondary)', fontSize: 'var(--font-size-body)', lineHeight: 1,
  cursor: 'pointer', textDecoration: 'none',
};

function IconButton({ label, onClick, glyph }: { label: string; onClick: () => void; glyph: string }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} style={iconButtonStyle}>
      <span aria-hidden>{glyph}</span>
    </button>
  );
}
