'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChatInput, type ComposerStarters } from '@/components/ChatInput';
import { applyTemplateEntry } from '@/lib/templates/apply';
import { UpgradeModal } from '@/components/UpgradeModal';
import { StudioApps } from './StudioApps';
import { StudioRecentProjects } from './StudioRecentProjects';
import { useStartStudioSession } from './useStartStudioSession';

/**
 * The Studio home: "What will you build?".
 *
 * Inside the site's own chrome — `/studio` is a public page (`lib/shellRouting.ts`,
 * `PUBLIC_SHELL_PATHS`), so the header is the one every other page has and this renders a
 * `<section>`, never a second `<main>` (the shell provides `<main id="main-content">`).
 *
 * No sign-in to start: "Build it" opens a creation session — a guest's `local-<uuid>` or a
 * server session — on the Studio lens (`/studio/<id>`), the canvas's App surface drawn as
 * prompt + preview. "Your apps" is every board with an app — this browser's and the
 * workspace's — reopened in Studio; below it, any durable Studio projects from before,
 * which open in the Studio IDE.
 */
export function StudioHome() {
  const t = useTranslations('studio.home');
  const { start, busy, error, planError, clearPlanError } = useStartStudioSession(t('startFailed'));
  const [prompt, setPrompt] = useState('');
  const router = useRouter();
  // Starting points from `+`, inside the box — the same as every other prompt. A prompt
  // entry seeds the box; an installable one opens its setup in the templates gallery.
  const starters = useMemo<ComposerStarters>(() => ({
    onSelect: (entry) => applyTemplateEntry(entry, {
      onPrompt: setPrompt,
      onInstall: (key) => router.push(`/templates?open=${encodeURIComponent(key)}`),
    }),
  }), [router]);

  return (
    <section style={{ width: 'min(760px, 100%)', margin: '0 auto', padding: 'clamp(32px, 10vh, 120px) 16px 48px', boxSizing: 'border-box', display: 'grid', alignContent: 'start', gap: 28, color: 'var(--text-primary)' }}>
      <div style={{ textAlign: 'center', display: 'grid', gap: 10 }}>
        <h1 className="ui-text-hero" style={{ margin: 0 }}>{t('title')}</h1>
        <p className="ui-text-lede" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('subtitle')}</p>
      </div>
      {/* THE one composer every prompt uses — not a page-local textarea and button. */}
      <ChatInput
        value={prompt}
        onChange={setPrompt}
        onSubmit={() => start(prompt)}
        placeholder={t('placeholder')}
        ariaLabel={t('promptLabel')}
        submitLabel={t('submit')}
        disabled={busy}
        rows={3}
        showVoice
        starters={starters}
      />
      {error && <p role="alert" style={{ margin: 0, color: 'var(--error-text)' }}>{error}</p>}
      <StudioApps />
      <StudioRecentProjects />
      <UpgradeModal error={planError} onClose={clearPlanError} />
    </section>
  );
}
