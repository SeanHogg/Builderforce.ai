'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { StudioTopBar } from './StudioTopBar';
import { StudioPromptBox } from './StudioPromptBox';
import { StudioRecentProjects } from './StudioRecentProjects';
import { StudioWorkspacePicker } from './StudioWorkspacePicker';
import { useStudioWorkspace } from './useStudioWorkspace';
import { useStartStudioProject } from './useStartStudioProject';
import { useSignInDialog } from '@/components/auth/signIn/SignInDialogProvider';
import { studioDraft } from '@/lib/studio/promptHandoff';

/**
 * The Studio home: "what will you build?". A visitor can type before signing in;
 * sending then opens the sign-in pop-up, and the build starts by itself the
 * moment there is a session and a workspace. The draft survives a sign-in that
 * had to reload the page.
 */
export function StudioHome() {
  const t = useTranslations('studio.home');
  const { requestSignIn } = useSignInDialog();
  const workspace = useStudioWorkspace();
  const { start, busy, error } = useStartStudioProject(t('untitled'), t('startFailed'));
  const [prompt, setPrompt] = useState('');
  const [wantsToStart, setWantsToStart] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrompt(studioDraft.load());
  }, []);

  useEffect(() => {
    if (!wantsToStart || workspace.status !== 'ready') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWantsToStart(false);
    void start(prompt);
  }, [wantsToStart, workspace.status, start, prompt]);

  const send = () => {
    studioDraft.save(prompt);
    setWantsToStart(true);
    if (workspace.status === 'signedOut') requestSignIn();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      <StudioTopBar />
      <main style={{ flex: 1, width: 'min(760px, 100%)', margin: '0 auto', padding: 'clamp(32px, 10vh, 120px) 16px 48px', display: 'grid', alignContent: 'start', gap: 28 }}>
        <div style={{ textAlign: 'center', display: 'grid', gap: 10 }}>
          <h1 className="ui-text-hero" style={{ margin: 0 }}>{t('title')}</h1>
          <p className="ui-text-lede" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('subtitle')}</p>
        </div>
        <StudioPromptBox value={prompt} onChange={setPrompt} onSubmit={send} busy={busy} />
        {error && <p role="alert" style={{ margin: 0, color: 'var(--error-text)' }}>{error}</p>}
        <StudioWorkspacePicker state={workspace} onChoose={(tenant) => { void workspace.choose(tenant); }} />
        <StudioRecentProjects />
      </main>
    </div>
  );
}
