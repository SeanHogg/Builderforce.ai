import { memo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ThemeSelect } from '@/components/ThemeSelect';
import { InlineChatTitle } from '@seanhogg/builderforce-brain-ui';
import type { BrainChat } from '@/lib/builderforceApi';
import type { Project } from '@/lib/types';
import { canvasAppPath } from '@/lib/studio/studioHost';

export const BrainConversationHeader = memo(function BrainConversationHeader({ chat, projects, projectName, onAssign, onNewProject, onRename }: {
  chat: BrainChat | null;
  projects: Project[];
  projectName: (id: number | null) => string;
  onAssign: (chatId: number, projectId: number | null) => void;
  onNewProject: () => void;
  /** Persist a new title for the open chat (the inline title's commit path). */
  onRename?: (chatId: number, title: string) => void;
}) {
  const tBrain = useTranslations('brain');
  if (!chat) return null;
  return (
    <div className="bs-chat-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      {/* THE open chat's own name, edited where it is shown — Enter saves, Escape reverts. */}
      <InlineChatTitle
        title={chat.title}
        chatId={chat.id}
        onRename={onRename}
        labels={{ edit: tBrain('editTitleAria'), label: tBrain('chatTitleAria'), save: tBrain('saveTitleAria'), cancel: tBrain('cancelTitleAria') }}
        titleClassName="bs-chat-header__title"
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {chat.projectId == null ? (
          <>
            <label style={{ fontSize: 'var(--font-size-small)', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {tBrain('assignToProject')}
              <ThemeSelect
                ariaLabel={tBrain('assignChatToProjectAria')}
                value=""
                onChange={(val) => { if (val === '__new__') onNewProject(); else if (val !== '') onAssign(chat.id, Number(val)); }}
                options={[
                  { value: '', label: tBrain('noProject') },
                  { value: '__new__', label: tBrain('createNewProject') },
                  ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                ]}
                style={{ minWidth: 140, padding: '4px 8px', fontSize: 'var(--font-size-small)' }}
              />
            </label>
            <button type="button" onClick={onNewProject} style={{ fontSize: 'var(--font-size-small)', padding: '4px 8px', cursor: 'pointer', fontWeight: 600, color: 'var(--accent)' }}>{tBrain('addProject')}</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--muted)' }}>{projectName(chat.projectId)}</span>
            <Link href={`/workflows?project=${chat.projectId}`} style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>{tBrain('workflowsArrow')}</Link>
            <Link href={canvasAppPath(chat.projectId, `chat=${chat.id}`)} style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--coral-bright)', textDecoration: 'none', padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--coral-bright)' }}>{tBrain('openInBuilder')}</Link>
          </>
        )}
      </div>
    </div>
  );
});
