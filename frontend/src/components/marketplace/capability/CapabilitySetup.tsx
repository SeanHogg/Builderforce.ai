'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReplaySiteDto } from '@builderforce/interaction-contract';
import { ButtonLink, SectionLoading } from '@/components/ui';
import { registerHref } from '@/lib/auth';
import { useRequireSession } from '@/lib/useRequireSession';
import { useCapability } from '@/lib/useCapability';
import { capabilityAppFor } from '@/lib/marketplace/capabilityApps';
import { SETUP_STEPS } from './setupSteps';
import styles from './capability.module.css';

/**
 * THE set-up page for a capability app (PRD 33 §4.2): the `SETUP_STEPS`
 * registry, one step at a time. A step advances only when its own call
 * succeeded (it calls `onDone`); the page never skips one on its own except the
 * install, which a workspace that already holds the listing has done.
 */
export function CapabilitySetup({ appId }: { appId: string }) {
  const t = useTranslations('marketplace.capability');
  const tApps = useTranslations('apps');
  const router = useRouter();
  const app = capabilityAppFor(appId);
  // A workspace is a STEP here, not a precondition: no redirect to the picker.
  const session = useRequireSession({ requireTenant: false, redirect: false });
  const { state, entitled } = useCapability(app?.listingSlug ?? '');
  const [index, setIndex] = useState<number | null>(null);
  const [site, setSite] = useState<ReplaySiteDto | null>(null);

  // Start where this workspace stands: a workspace that holds the listing starts at the site.
  useEffect(() => {
    if (index !== null || session === 'loading' || session === 'anonymous') return;
    if (session === 'no-tenant') { setIndex(0); return; }
    if (entitled === null) return;
    setIndex(state?.installed || entitled ? 1 : 0);
  }, [index, session, entitled, state]);

  if (!app) return null;
  const name = tApps(`${app.nameKey}.name` as never);

  if (session === 'anonymous') {
    return (
      <div className={styles.page}>
        <div className={styles.card} data-testid="setup-signed-out">
          <h1 className={styles.title}>{t('setupTitle', { app: name })}</h1>
          <p className={styles.body}>{t('signUpFirst', { app: name })}</p>
          <ButtonLink href={registerHref(app.setupPath, app.intent)} variant="primary">{t('startFree')}</ButtonLink>
        </div>
      </div>
    );
  }
  if (index === null) return <SectionLoading label={t('loading')} />;

  const step = SETUP_STEPS[index]!;
  const advance = (next?: ReplaySiteDto) => {
    const current = next ?? site;
    if (next) setSite(next);
    if (index + 1 < SETUP_STEPS.length) { setIndex(index + 1); return; }
    router.push(current ? `${app.homePath}?site=${encodeURIComponent(current.id)}` : app.homePath);
  };

  return (
    <div className={styles.page} data-testid="capability-setup">
      <h1 className={styles.title}>{t('setupTitle', { app: name })}</h1>
      <ol className={styles.steps} aria-label={t('stepsLabel')}>
        {SETUP_STEPS.map((def, at) => (
          <li
            key={def.id}
            className={`${styles.stepPill} ${at === index ? styles.stepCurrent : at < index ? styles.stepDone : ''}`}
            aria-current={at === index ? 'step' : undefined}
            data-step={def.id}
          >
            {t(`steps.${def.id}` as never)}
          </li>
        ))}
      </ol>
      <section className={styles.card} data-testid={`setup-step-${step.id}`} aria-label={t(`steps.${step.id}` as never)}>
        <step.Component app={app} site={site} onDone={advance} />
      </section>
    </div>
  );
}
