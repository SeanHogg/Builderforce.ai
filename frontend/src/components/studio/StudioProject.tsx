'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary';
import { LazyBuilderWorkspace } from '@/components/builder/LazyBuilderWorkspace';
import { useBuildProject } from '@/hooks/useBuildProject';
import { useSignInDialog } from '@/components/auth/signIn/SignInDialogProvider';
import { takeHandedOffPrompt } from '@/lib/studio/promptHandoff';
import { StudioTopBar, StudioBrand } from './StudioTopBar';
import { StudioAccountControl } from './StudioAccountControl';
import { StudioProjectActions } from './StudioProjectActions';
import { OpenOnCanvasLink } from './OpenOnCanvasLink';
import { WorkspacePicker } from '@/components/auth/WorkspacePicker';
import { useWorkspaceSession } from '@/lib/auth/useWorkspaceSession';

/**
 * A Studio project: the full Builder workspace under Studio's bar. Signed out, it
 * asks for a sign-in in place (the pop-up), and opens the project the moment the
 * session and workspace are there. A prompt sent from the Studio home starts the
 * agent on first open. A link naming a project chat (`?chat=`, `?ticket=`) opens that chat.
 */
export function StudioProject({ projectId, initialChatId = null, initialTicket = null }: {
  projectId: number;
  initialChatId?: number | null;
  initialTicket?: { kind: string; ref: string } | null;
}) {
  const t = useTranslations('studio.project');
  const { requestSignIn } = useSignInDialog();
  const workspace = useWorkspaceSession();
  const ready = workspace.status === 'ready';
  const { project, files, error, setProject } = useBuildProject(ready ? projectId : null, t('loadFailed'));
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (workspace.status === 'signedOut') requestSignIn();
  }, [workspace.status, requestSignIn]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialPrompt(takeHandedOffPrompt(projectId));
  }, [projectId]);

  return (
    // Its own stacking layer: the app's fixed starfield (z-index 0) otherwise paints
    // over every non-positioned surface here — it showed through the chat column.
    <div style={{ height: '100dvh', position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      {/* An open project has ONE header row: the workspace's. Studio hands it the
          mark and its actions (Share, Publish, the account) instead of stacking its
          own bar above — two rows of actions was what people found confusing. The
          Studio bar is only for the states before a project is open. */}
      {!(ready && project && !error) && <StudioTopBar />}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {workspace.status === 'signedOut' ? (
          <Centered>{t('signInLead')}</Centered>
        ) : !ready ? (
          <Centered><WorkspacePicker state={workspace} onChoose={(tenant) => { void workspace.choose(tenant); }} /></Centered>
        ) : error ? (
          <Centered><span role="alert">{error}</span></Centered>
        ) : !project ? (
          <Centered>{t('loading')}</Centered>
        ) : (
          <ChunkErrorBoundary>
            <LazyBuilderWorkspace
              project={project}
              initialFiles={files}
              initialPrompt={initialPrompt}
              initialChatId={initialChatId}
              initialTicket={initialTicket ?? undefined}
              onProjectUpdate={setProject}
              headerLeading={<StudioBrand compact />}
              headerTrailing={(
                <>
                  <OpenOnCanvasLink projectId={project.id} publicId={project.publicId} />
                  <StudioProjectActions projectId={project.id} />
                  <StudioAccountControl />
                </>
              )}
            />
          </ChunkErrorBoundary>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
      <div style={{ width: 'min(520px, 100%)' }}>{children}</div>
    </div>
  );
}
