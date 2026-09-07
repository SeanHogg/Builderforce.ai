'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui';
import { useFormat } from '@/i18n/useFormat';
import type { CreationSessionSummary } from '@/lib/builderforceApi';
import styles from './CreationSessionTile.module.css';

/**
 * A session tile is coloured by the KIND of object it holds, and the board's
 * minimap colours the same objects the same way — so this is the board's identity
 * list, not a second one. It is read from the tokens rather than restated: this
 * copy had already drifted (`website` was the brand blue here and its own hue
 * there), which is what a duplicated palette does.
 */
const KIND_COLOR: Record<string, string> = {
  workflow: 'var(--canvas-obj-workflow)', website: 'var(--canvas-obj-website)',
  chat: 'var(--canvas-obj-chat)', dashboard: 'var(--canvas-obj-dashboard)',
  project: 'var(--canvas-obj-staff)', agent: 'var(--canvas-obj-agent)',
  dataset: 'var(--canvas-obj-dataset)', mockup: 'var(--canvas-obj-mockup)',
};

const RUNNING_KINDS = ['agent', 'task', 'workflow'];
const RUNNING_STATUSES = ['running', 'in progress', 'in_progress', 'queued', 'assigned'];

interface Props {
  session: CreationSessionSummary;
  /** `card` is the gallery, `table` the row list — the same facts, one layout token. */
  view: 'card' | 'table';
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  /** Reads a linked project's name; the tile never fetches one itself. */
  projectLabel: (projectId: number) => string;
  onOpen: () => void;
  /** Clicking the folder chip filters the library to that folder, and clears it
   *  again. The folder's ID, not its name — a rename must not drop the filter. */
  onFolderSelect: (folderId: string) => void;
  folderActive: boolean;
  /** The session's own actions, rendered at the foot of the tile. */
  children?: ReactNode;
}

export function CreationSessionTile({ session, view, selected, onSelectedChange, projectLabel, onOpen, onFolderSelect, folderActive, children }: Props) {
  const t = useTranslations('creationCanvas');
  const fmt = useFormat();
  const objects = session.preview?.objects ?? [];
  const running = objects.filter((object) => RUNNING_KINDS.includes(object.kind) && RUNNING_STATUSES.includes(String(object.status || '').toLowerCase())).length;

  return (
    <article
      className={styles.tile}
      data-view={view}
      data-unread={session.unread ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter') onOpen(); }}
      tabIndex={0}
    >
      <div className={styles.preview}>
        {objects.slice(0, 8).map((object, index) => (
          <span key={object.id} title={object.title} className={styles.previewObject} style={{
            left: `${12 + ((Math.abs(object.x) + index * 31) % 68)}%`,
            top: `${14 + ((Math.abs(object.y) + index * 23) % 58)}%`,
            borderColor: KIND_COLOR[object.kind] ?? 'var(--canvas-obj-unknown)',
          }} />
        ))}
        {objects.length === 0 && <span className={styles.previewEmpty}>{t('blankCanvasEmpty')}</span>}
        <input
          type="checkbox"
          className={styles.select}
          checked={selected}
          aria-label={t('selectSession', { title: session.title })}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onSelectedChange(event.target.checked)}
        />
      </div>
      <div className={styles.body}>
        <div className={styles.details}>
        <strong className={styles.title}>{session.pinned && <Icon name="pin" size={14} />} {session.title}{session.unread ? ` · ${t('unreadBadge')}` : ''}</strong>
        <div className={styles.badges}>
          {(session.preview?.kinds ?? []).slice(0, 5).map((kind) => <small key={kind} className={styles.kind}>{kind}</small>)}
          {(session.projectIds ?? []).map((id) => <small key={id} className={styles.project}>{projectLabel(id)}</small>)}
        </div>
        {/* The date sits with the rest of the facts about this session rather
            than pinned to the far edge of the row, where it read as a column of
            a table nobody had asked for and left the meta line half empty. */}
        <div className={styles.meta}>
          <span>{t('sessionObjectsPeople', { objects: session.preview?.objectCount ?? 0, people: session.collaboratorCount ?? 1 })}</span>
          {running > 0 && <span>{t('sessionRunning', { count: running })}</span>}
          <span>{fmt.date(session.lastActivityAt)}</span>
        </div>
        {session.folderName && session.folderId && (
          <button
            type="button"
            className={styles.folder}
            aria-pressed={folderActive}
            onClick={(event) => { event.stopPropagation(); onFolderSelect(session.folderId!); }}
          >
            <Icon name="folder" size={13} /> {session.folderName}
          </button>
        )}
        </div>
        {/* A row puts its actions at the right end; a card puts them along the
            foot. Same markup, one layout token. */}
        <div className={styles.actions}>{children}</div>
      </div>
    </article>
  );
}
