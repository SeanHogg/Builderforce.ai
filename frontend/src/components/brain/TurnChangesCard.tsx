import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { useDockedBrain } from '@/lib/brain/dockedBrain';
import { turnChangedFiles } from '@/lib/brain/turnChanges';
import { sendWorkspaceCommand } from '@/lib/workspace/workspaceCommands';

/** How many paths the card names before "+ N more". */
const NAMED = 3;

/**
 * "5 files changed · Review changes" under an agent turn's last reply: what the
 * turn did to the project, without leaving the conversation. Each path opens in the
 * Code view; Review opens Versions, where the turn is one entry to compare or undo.
 *
 * Only where the Brain is docked beside the workspace that owns those files — the
 * buttons talk to that workspace — and only for a turn that committed a file.
 */
export function TurnChangesCard({ messages, replyId, projectId }: {
  messages: ReadonlyArray<{ id: number; role: string; metadata: string | null }>;
  replyId: number;
  projectId: number | undefined;
}) {
  const t = useTranslations('brain.turnChanges');
  const docked = useDockedBrain();
  const files = useMemo(() => turnChangedFiles(messages, replyId), [messages, replyId]);
  if (!docked || projectId == null || !files || files.length === 0) return null;

  const more = files.length - NAMED;
  return (
    <section
      aria-label={t('title', { count: files.length })}
      style={{
        flexBasis: '100%', marginBottom: 6, overflow: 'hidden',
        border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
        <Icon name="document" size={15} />
        <strong style={{ flex: 1, fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}>{t('title', { count: files.length })}</strong>
        <button
          type="button"
          onClick={() => sendWorkspaceCommand(projectId, { type: 'openTab', tab: 'versions' })}
          style={{ border: 0, background: 'none', padding: '4px 2px', minHeight: 28, cursor: 'pointer', color: 'var(--accent)', fontSize: 'var(--font-size-small)', fontWeight: 600 }}
        >
          {t('review')}
        </button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
        {files.slice(0, NAMED).map((path) => (
          <li key={path}>
            <button
              type="button"
              onClick={() => sendWorkspaceCommand(projectId, { type: 'openFile', path })}
              title={t('open', { path })}
              style={{
                display: 'block', width: '100%', minHeight: 28, padding: '4px 10px', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left',
                fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {path}
            </button>
          </li>
        ))}
        {more > 0 && (
          <li style={{ padding: '2px 10px 4px', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('more', { count: more })}</li>
        )}
      </ul>
    </section>
  );
}
