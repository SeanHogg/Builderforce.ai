'use client';

/**
 * The associate's LANDING — provision, seed, open.
 *
 * Three steps, each idempotent, because a person can arrive here from a fresh
 * registration, a second sign-in, or a bookmark:
 *
 *   1. a workspace, if they have none (a sales account signs up without one);
 *   2. the prescriptive board (`buildSalesHubGraph`), if it has never been built;
 *   3. a redirect onto it.
 *
 * The SUPERADMIN branch that used to live here — the associate roster — moved to
 * `/admin/sales`, where an admin view belongs. A route that answered "am I an
 * associate or the platform owner?" and rendered two unrelated products was one
 * component doing two jobs, and it is why the owner's view had no reports in it.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { salesApi } from '@/lib/salesApi';
import { createTenant } from '@/lib/auth';
import { buildSalesHubGraph } from '@/lib/sales/salesHubCanvas';
import styles from './salesCanvasLauncher.module.css';

export default function SalesCanvasLauncher() {
  const t = useTranslations('salesHub.launcher');
  const router = useRouter();
  const { user, hasTenant, webToken, fetchTenants, selectTenant } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const provisioningRef = useRef(false);
  const canvasLaunchRef = useRef(false);

  useEffect(() => {
    if (!user) return;

    if (!hasTenant) {
      if (!webToken || provisioningRef.current) return;
      provisioningRef.current = true;
      void (async () => {
        try {
          const existing = await fetchTenants();
          const tenant = existing[0] ?? await createTenant(webToken, t('workspaceName', { name: user.name || t('defaultOwner') }));
          await selectTenant(tenant);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : t('workspaceFailed'));
        } finally {
          provisioningRef.current = false;
        }
      })();
      return;
    }

    if (canvasLaunchRef.current) return;
    canvasLaunchRef.current = true;
    void (async () => {
      try {
        const existing = await salesApi.canvas();
        if (existing.sessionId) { router.replace(`/create/${existing.sessionId}`); return; }
        const created = await creationSessionsApi.create({
          title: t('canvasTitle'),
          description: t('canvasDescription'),
          initialPrompt: t('canvasPrompt'),
        });
        await creationSessionsApi.saveGraph(created.session.id, {
          ...buildSalesHubGraph({
            ownerUserId: user.id,
            referralCode: existing.referralCode,
            salesCode: existing.salesCode,
            origin: window.location.origin,
          }),
          expectedRevision: created.session.revision,
        });
        await salesApi.setCanvas(created.session.id);
        router.replace(`/create/${created.session.id}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('canvasFailed'));
        canvasLaunchRef.current = false;
      }
    })();
  }, [fetchTenants, hasTenant, router, selectTenant, t, user, webToken]);

  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <h1>{t('heading')}</h1>
        <p>{error ?? t('preparing')}</p>
        {error && <p className={styles.error}>{t('retryHint')}</p>}
      </section>
    </main>
  );
}
