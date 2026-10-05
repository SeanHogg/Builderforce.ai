import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon, type IconName } from '@/components/ui/Icon';
import { BrainMark } from './BrainMark';
import { UnreadBadge } from '@/components/UnreadBadge';

export type BrainDockedTab = 'chat' | 'history';

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
  /** What the agent is working with, as chips beside the title (supplied by the host). */
  context?: React.ReactNode;
}

/**
 * The docked Brain's chrome: the name, then icon actions — History, New chat,
 * Expand (and Close in the drawer). History is a toggle, not a tab: the panel IS
 * the conversation, and the chat list is somewhere you go and come back from.
 * The host's context (what the agent sees) sits beside the name on the SAME row.
 *
 * Responsive: one row that never wraps — the context slot is the only thing that
 * shrinks (its chips ellipsize), so at 360px the actions stay put and nothing clips.
 * Theme tokens throughout.
 */
export function BrainDockedHeader({ tab, onTabChange, historyUnread, onNewChat, expandHref, onClose, actions, context }: BrainDockedHeaderProps) {
  const t = useTranslations('brain');
  const showingHistory = tab === 'history';
  const historyLabel = t(showingHistory ? 'historyHide' : 'historyShow');

  return (
    <header style={{ flexShrink: 0, padding: '6px 8px 6px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 4, minHeight: 48 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'var(--font-size-body)', color: 'var(--text-primary)', flexShrink: 0, marginRight: 4 }}>
        <span style={{ color: 'var(--accent)', display: 'inline-flex' }}><BrainMark /></span> {t('brainTitle')}
      </span>
      {/* The context slot takes the slack (and pushes the actions right); it is the
          one thing that shrinks. */}
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
        {context}
      </div>
      {actions}
      {/* History carries the "something is waiting in another chat" signal, so it is
          worth opening rather than guessing. */}
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <HeaderIconButton
          icon="clock"
          label={historyLabel}
          pressed={showingHistory}
          controls="brain-history"
          onClick={() => onTabChange(showingHistory ? 'chat' : 'history')}
        />
        {historyUnread > 0 && (
          <span style={{ position: 'absolute', top: -2, right: -2, pointerEvents: 'none' }}>
            <UnreadBadge count={historyUnread} size={16} />
          </span>
        )}
      </span>
      <HeaderIconButton icon="plus" label={t('newChatAria')} onClick={onNewChat} />
      {/* Expand → the full Brain page, on the SAME conversation (the href carries
          the open chat), so expanding never reads as the chat being lost. */}
      <Link href={expandHref} title={t('openFullBrainStorm')} aria-label={t('openFullBrainStorm')} style={iconButtonStyle(false)}>
        <Icon name="maximize" size={16} />
      </Link>
      {onClose && <HeaderIconButton icon="close" label={t('closeBrain')} onClick={onClose} />}
    </header>
  );
}

const iconButtonStyle = (pressed: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, padding: 0, borderRadius: 'var(--radius-md)',
  border: `1px solid ${pressed ? 'var(--border-subtle)' : 'transparent'}`,
  background: pressed ? 'var(--bg-elevated)' : 'transparent',
  color: pressed ? 'var(--accent)' : 'var(--text-secondary)',
  cursor: 'pointer', textDecoration: 'none', flexShrink: 0,
});

function HeaderIconButton({ icon, label, onClick, pressed, controls }: {
  icon: IconName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      aria-controls={controls}
      style={iconButtonStyle(!!pressed)}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
