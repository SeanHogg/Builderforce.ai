'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useIsFreelancer } from '@/lib/rbac';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { useOnboardingPrompt } from '@/lib/onboarding';
import { stepsForAccountType } from './OnboardingStepper';
import { SlideOutPanel } from './SlideOutPanel';

/**
 * OnboardingProgressPill — a self-gating header chip showing how much of a new
 * account's background setup is done. Clicking opens a slide-out listing every
 * configuration step (workspace, project, ticketing, repos, audits, roster,
 * install, invite — or the hired track) with its completion, plus a button to
 * jump back into the wizard.
 *
 * Self-gating: renders nothing once onboarding is complete/dismissed or for
 * non-owner members (mirrors {@link useOnboardingPrompt}), so the TopBar can drop
 * it in unconditionally — no `canShow` prop drilled from the header.
 */
export function OnboardingProgressPill() {
  const t = useTranslations('onboardingPill');
  const tSteps = useTranslations('onboarding');
  const router = useRouter();
  const { hasTenant } = useAuth();
  const isFreelancer = useIsFreelancer();
  const projectScope = useOptionalProjectScope();
  const { show, progress } = useOnboardingPrompt();
  const [open, setOpen] = useState(false);

  const steps = stepsForAccountType(isFreelancer);
  const projectCount = projectScope?.projects.length ?? 0;

  const { doneSet, pct } = useMemo(() => {
    const done = new Set<string>(
      (progress?.completed ?? []).filter((id) => (steps as string[]).includes(id)),
    );
    // Implicit completions the wizard treats as done even before it persists them,
    // so the pill agrees with the stepper's resumed state.
    if (!isFreelancer && hasTenant) done.add('workspace');
    if (!isFreelancer && hasTenant && projectCount > 0) done.add('project');
    return { doneSet: done, pct: Math.round((done.size / steps.length) * 100) };
  }, [progress, steps, isFreelancer, hasTenant, projectCount]);

  // Only for accounts that still need setup (owners/hired mid-onboarding).
  if (!show) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('title')}
        aria-label={t('ariaLabel', { pct })}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 30, padding: '0 10px', borderRadius: 999, cursor: 'pointer',
          border: '1px solid var(--coral-bright)', background: 'var(--surface-coral-soft, rgba(244,114,110,0.12))',
          color: 'var(--coral-bright)', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden>✨</span>
        {t('label', { pct })}
      </button>

      <SlideOutPanel open={open} onClose={() => setOpen(false)} title={t('panelTitle')} width="min(440px, 96vw)">
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('progressLabel')}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t('percentDone', { pct })}</span>
            </div>
            {/* Progress track — theme-aware, adapts to both modes. */}
            <div style={{ height: 8, borderRadius: 999, background: 'var(--border-subtle)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, var(--coral-bright), var(--coral-dark, #d94f4a))', borderRadius: 999 }} />
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{t('intro')}</p>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {steps.map((id) => {
              const done = doneSet.has(id);
              return (
                <li
                  key={id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 10,
                    background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700,
                      background: done ? '#22c55e' : 'transparent',
                      border: done ? 'none' : '1px solid var(--border-subtle)',
                      color: done ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    {done ? '✓' : ''}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: done ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: done ? 'line-through' : 'none' }}>
                    {tSteps(`steps.${id}.label`)}
                  </span>
                  <span style={{ fontSize: 11, color: done ? '#22c55e' : 'var(--text-muted)' }}>
                    {done ? t('statusDone') : t('statusTodo')}
                  </span>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={() => { setOpen(false); router.push('/dashboard'); }}
            style={{
              alignSelf: 'stretch', padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
              border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark, #d94f4a))',
              color: '#fff', fontWeight: 700, fontSize: 14,
            }}
          >
            {pct >= 100 ? t('reviewSetup') : t('continueSetup')}
          </button>
        </div>
      </SlideOutPanel>
    </>
  );
}
