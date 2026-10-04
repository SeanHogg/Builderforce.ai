import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { chatSwitcherLabel } from '@seanhogg/builderforce-brain-ui';
import { AttentionDot } from '@/components/AttentionDot';
import { UnreadBadge } from '@/components/UnreadBadge';
import { ThemeSelect } from '@/components/ThemeSelect';
import { useFormat } from '@/i18n/useFormat';
import type { AttentionState, BrainChat } from '@/lib/builderforceApi';
import type { Project } from '@/lib/types';
import { formatTime } from './brainPanelUtils';

export interface BrainChatRowProps {
  chat: BrainChat;
  /** Page rows use the `bs-chat-item` stylesheet; docked rows are styled inline. */
  isPage: boolean;
  active: boolean;
  actionsOpen: boolean;
  renaming: boolean;
  /** The rename draft — only meaningful (and only passed) for the row being renamed. */
  renameValue: string;
  summarizing: boolean;
  deleting: boolean;
  busy: boolean;
  attention: AttentionState | null | undefined;
  unread: number | undefined;
  pinnedProjectId: number | null;
  projects: Project[];
  projectName: (id: number | null) => string;
  onOpen: (id: number) => void;
  onToggleActions: (id: number) => void;
  onStartRename: (chat: BrainChat) => void;
  onRenameChange: (value: string) => void;
  onSubmitRename: (id: number, value: string) => void;
  onCancelRename: () => void;
  onSummarize: (id: number) => void;
  onDelete: (chat: BrainChat) => void;
  onAssign: (chatId: number, projectId: number | null) => void;
  onNewProject: () => void;
}

/** One chat-history row: title (or its rename input), meta line, and its revealed actions. */
export const BrainChatRow = memo(function BrainChatRow({
  chat,
  isPage,
  active,
  actionsOpen,
  renaming,
  renameValue,
  summarizing,
  deleting,
  busy,
  attention,
  unread,
  pinnedProjectId,
  projects,
  projectName,
  onOpen,
  onToggleActions,
  onStartRename,
  onRenameChange,
  onSubmitRename,
  onCancelRename,
  onSummarize,
  onDelete,
  onAssign,
  onNewProject,
}: BrainChatRowProps) {
  const fmt = useFormat();
  const tBrain = useTranslations('brain');
  const tCommon = useTranslations('common');
  const submitRename = () => onSubmitRename(chat.id, renameValue);
  return (
    <div
      className={isPage ? `bs-chat-item ${active ? 'active' : ''}` : undefined}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(chat.id)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(chat.id)}
      style={isPage ? undefined : {
        padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        borderLeft: active ? '3px solid var(--coral-bright)' : '3px solid transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--font-size-small)', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {renaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') { onCancelRename(); } }}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', fontSize: 'var(--font-size-small)', padding: 2, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}
            />
          ) : chatSwitcherLabel({
            title: chat.title,
            id: chat.id,
            ticketCount: chat.ticketCount,
            ticketProgressPct: chat.ticketProgressPct,
          })}
        </div>
        {!renaming && (
          <button
            type="button"
            aria-expanded={actionsOpen}
            aria-label={tBrain('chatActionsAria', { title: chat.title })}
            title={tBrain('chatActions')}
            onClick={(e) => { e.stopPropagation(); onToggleActions(chat.id); }}
            style={{ flexShrink: 0, width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-size-small)', lineHeight: 1, borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: actionsOpen ? 'var(--bg-elevated)' : 'transparent', border: '1px solid', borderColor: actionsOpen ? 'var(--border-subtle)' : 'transparent', color: 'var(--text-muted)' }}
          >
            ⋯
          </button>
        )}
      </div>
      <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {chat.projectId != null && pinnedProjectId == null && (
          <span style={{ background: 'var(--bg-elevated)', padding: '1px 4px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-field-label)' }}>
            {projectName(chat.projectId)}
          </span>
        )}
        {formatTime(fmt, chat.updatedAt)}
        <AttentionDot state={attention} />
        {/* Unread badge — new messages (execution milestones, teammate/agent
            turns) in a chat you're not viewing. The OPEN chat is read, so it
            never shows one. */}
        <UnreadBadge count={active ? 0 : unread} />
      </div>
      {actionsOpen && !renaming && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => onStartRename(chat)} style={{ fontSize: 'var(--font-size-eyebrow)', padding: '2px 6px', cursor: 'pointer' }}>{tBrain('rename')}</button>
          <button type="button" onClick={() => onSummarize(chat.id)} disabled={summarizing} style={{ fontSize: 'var(--font-size-eyebrow)', padding: '2px 6px', cursor: 'pointer' }}>{summarizing ? '…' : tBrain('summarize')}</button>
          <button type="button" onClick={() => onDelete(chat)} disabled={deleting} style={{ fontSize: 'var(--font-size-eyebrow)', padding: '2px 6px', cursor: 'pointer', color: 'var(--coral-bright)' }}>{deleting ? '…' : tCommon('delete')}</button>
          {chat.projectId == null && pinnedProjectId == null && (
            <label style={{ fontSize: 'var(--font-size-eyebrow)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {tBrain('addTo')}
              <ThemeSelect
                ariaLabel={tBrain('addChatToProjectAria')}
                value=""
                onChange={(val) => { if (val === '__new__') onNewProject(); else if (val !== '') onAssign(chat.id, Number(val)); }}
                options={[
                  { value: '', label: tBrain('addToProject') },
                  { value: '__new__', label: tBrain('createNewProject') },
                  ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                ]}
                style={{ marginLeft: 0, minWidth: 120, padding: '2px 6px', fontSize: 'var(--font-size-eyebrow)' }}
              />
              {busy && <span style={{ color: 'var(--text-muted)' }}>…</span>}
            </label>
          )}
        </div>
      )}
    </div>
  );
});
