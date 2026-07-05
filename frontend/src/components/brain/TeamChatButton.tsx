'use client';

/**
 * TeamChatButton — the single, shared entry point into a Team Chat (migration 0294).
 *
 * Team Chat is the canonical, always-there GROUP conversation for a team — humans AND
 * agents post into the SAME thread. One button, scoped three ways:
 *   • projectId → that project's team chat        (Project / IDE header)
 *   • teamId    → a named workforce team's chat    (a team card in TeamsView)
 *   • neither   → the tenant-wide "broader team"   (Workforce header)
 *
 * It resolves-or-creates the chat via the API, then opens the docked Brain drawer on
 * it (the drawer's active chat is controlled by BrainContext, so this selects it and
 * lazily loads it even though team chats are excluded from the normal chat list).
 *
 * DRY: the component decides its own visibility — with no Brain context there's nowhere
 * to open the drawer, so it renders nothing. Consumers never gate on that themselves.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOptionalBrainContext } from '@/lib/brain';
import { brain } from '@/lib/builderforceApi';

export interface TeamChatButtonProps {
  projectId?: number | null;
  teamId?: number | null;
  /** 'icon' = compact glyph button; 'labeled' = glyph + text. */
  variant?: 'icon' | 'labeled';
  /** Override the default (scope-derived) accessible label. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function TeamChatButton({
  projectId = null,
  teamId = null,
  variant = 'icon',
  label,
  className,
  style,
}: TeamChatButtonProps) {
  const t = useTranslations('teamChat');
  const brainCtx = useOptionalBrainContext();
  const [loading, setLoading] = useState(false);

  const scopeKey = projectId != null ? 'project' : teamId != null ? 'team' : 'broader';
  const text = label ?? t(`open.${scopeKey}`);

  const open = useCallback(async () => {
    if (!brainCtx || loading) return;
    setLoading(true);
    try {
      const chat = await brain.getTeamChat({ projectId, teamId });
      brainCtx.setActiveChatId(chat.id);
      brainCtx.setContext({ initialChatId: chat.id });
      brainCtx.setOpen(true);
    } catch {
      /* The drawer surfaces load errors; the button just re-enables. */
    } finally {
      setLoading(false);
    }
  }, [brainCtx, loading, projectId, teamId]);

  // No Brain drawer to open → nothing to render.
  if (!brainCtx) return null;

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      title={text}
      aria-label={text}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: variant === 'labeled' ? 6 : 0,
        height: 28,
        minWidth: variant === 'labeled' ? undefined : 28,
        padding: variant === 'labeled' ? '0 10px' : 0,
        fontSize: 13,
        lineHeight: 1,
        background: 'var(--bg-elevated)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.6 : 1,
        ...style,
      }}
    >
      <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>💬</span>
      {variant === 'labeled' && <span>{text}</span>}
    </button>
  );
}

export default TeamChatButton;
