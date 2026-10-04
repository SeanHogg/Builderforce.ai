'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary';
import { LazyBuilderWorkspace } from '@/components/builder/LazyBuilderWorkspace';
import { useBuildProject } from '@/hooks/useBuildProject';
import { useSignInDialog } from '@/components/auth/signIn/SignInDialogProvider';
import { takeHandedOffPrompt } from '@/lib/studio/promptHandoff';
import { StudioTopBar } from './StudioTopBar';
import { StudioProjectActions } from './StudioProjectActions';
import { StudioWorkspacePicker } from './StudioWorkspacePicker';
import { useStudioWorkspace } from './useStudioWorkspace';

/**
 * A Studio project: the full Builder workspace under Studio's bar. Signed out, it
 * asks for a sign-in in place (the pop-up), and opens the project the moment the
 * session and workspace are there. A prompt sent from the Studio home starts the
 * agent on first open.
 */
export function StudioProject({ projectId }: { projectId: number }) {
  const t = useTranslations('studio.project');
  const { requestSignIn } = useSignInDialog();
  const workspace = useStudioWorkspace();
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
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      {/* No `title` here. The workspace below already names the project twice —
          its rename field and the description beside it — so putting the name in
          the bar as well made three copies of one string across two stacked rows,
          each truncated differently. The bar carries the brand and the actions;
          the workspace owns the project's identity. */}
      <StudioTopBar>
        {project && <StudioProjectActions projectId={project.id} />}
      </StudioTopBar>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {workspace.status === 'signedOut' ? (
          <Centered>{t('signInLead')}</Centered>
        ) : !ready ? (
          <Centered><StudioWorkspacePicker state={workspace} onChoose={(tenant) => { void workspace.choose(tenant); }} /></Centered>
        ) : error ? (
          <Centered><span role="alert">{error}</span></Centered>
        ) : !project ? (
          <Centered>{t('loading')}</Centered>
        ) : (
          <ChunkErrorBoundary>
            <LazyBuilderWorkspace project={project} initialFiles={files} initialPrompt={initialPrompt} onProjectUpdate={setProject} />
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
