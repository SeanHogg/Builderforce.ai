'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { creationSessionFoldersApi, creationSessionsApi, type CreationSessionFolder, type CreationSessionSummary } from '@/lib/builderforceApi';
import { SessionManagePanelFolderList, UNFILED, type FolderSelection } from './SessionManagePanelFolderList';
import { SessionManagePanelSessionList } from './SessionManagePanelSessionList';

/**
 * Organize sessions into folders and tie a folder (or a single session) to a
 * Project — opened from the caret on the sidebar's "+ New Canvas" split
 * button. Owns its own data: unlike the sidebar (which is scoped to the
 * TopBar's current project), this panel lists every active session across
 * every project so the user can reorganize freely, then reads
 * {@link useProjectScope} only for the project picker's options.
 */
export function SessionManagePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('sessionManagePanel');
  const projects = useOptionalProjectScope()?.projects ?? [];
  const [folders, setFolders] = useState<CreationSessionFolder[]>([]);
  const [sessions, setSessions] = useState<CreationSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FolderSelection>(null);

  const reload = () => {
    setLoading(true);
    Promise.all([creationSessionFoldersApi.list(), creationSessionsApi.list('active')])
      .then(([folderResult, sessionResult]) => {
        setFolders(folderResult.folders);
        setSessions(sessionResult.sessions);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) reload();
    else setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visibleSessions = selected == null
    ? sessions
    : selected === UNFILED
      ? sessions.filter((session) => !session.folderId)
      : sessions.filter((session) => session.folderId === selected);

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={t('title')}
      width="wide"
      widthStorageKey="session-manage"
      index={
        <SessionManagePanelFolderList
          folders={folders}
          projects={projects}
          sessions={sessions}
          selected={selected}
          onSelect={setSelected}
          onChanged={reload}
        />
      }
    >
      <div style={{ padding: 16 }}>
        <SessionManagePanelSessionList
          sessions={visibleSessions}
          folders={folders}
          projects={projects}
          loading={loading}
          onChanged={reload}
        />
      </div>
    </SlideOutPanel>
  );
}
