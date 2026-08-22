'use client';

import { useTranslations } from 'next-intl';

import { hasGithubRepo, useGithubActionsReadiness } from '@/lib/useGithubActionsReadiness';

/**
 * WHY this project cannot run an agent on GitHub Actions — the copy that used to
 * be a warning under the picker, now the accessible description of a control that
 * is actually disabled.
 *
 * Self-gating on purpose: it resolves its own readiness rather than taking a
 * `canUseActions` boolean, so no caller can render it with a stale or
 * hand-computed answer, and adding it beside a new control is one line. It takes
 * no surface prop, because the reason is a fact about the PROJECT: the picker
 * shows it whenever the option is disabled, not only once the user has selected
 * the thing they can no longer select.
 *
 * `id` exists so the control it explains can point at it with `aria-describedby`.
 * A disabled option whose reason is only visible to sighted users is not an
 * improvement on a warning nobody reads.
 *
 * Renders nothing unless the answer is a POSITIVE "not enabled": no project in
 * scope, a failed read, or a still-loading read all stay silent rather than
 * asserting something we did not actually verify.
 */
export function GithubActionsUnavailableReason({ id }: { id?: string }) {
  const t = useTranslations('githubActionsSurface');
  const { status } = useGithubActionsReadiness();

  if (!status || status.ready) return null;

  return (
    <div
      id={id}
      role="status"
      style={{
        marginTop: 8, padding: '10px 12px', borderRadius: 'var(--radius-md)',
        // Theme tokens only — --warning/--warning-bg are redefined per theme, so
        // this reads correctly in both light and dark.
        border: '1px solid var(--warning)',
        background: 'var(--warning-bg)',
        color: 'var(--text-strong)', fontSize: 12, lineHeight: 1.5,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>{t('notReadyTitle')}</strong>
      {hasGithubRepo(status) ? t('notReadyBody') : t('noGithubRepoBody')}
    </div>
  );
}
