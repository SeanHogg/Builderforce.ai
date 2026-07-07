'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { migrateContentManager } from '@/lib/contentManagerMigration';
import PageContainer from '@/components/PageContainer';

export const runtime = 'edge';

/**
 * Content Manager has been retired and folded into Knowledge. On visit we migrate
 * any content blocks this browser still holds in localStorage into
 * `knowledge_documents`, then redirect to /knowledge. Nothing is lost — a block
 * that fails to import is left in place for a later retry.
 */
export default function ContentManagerRedirect() {
  const router = useRouter();
  const t = useTranslations('contentManager');
  const { tenant, hasTenant } = useAuth();
  const ran = useRef(false);
  const [status, setStatus] = useState<'migrating' | 'done'>('migrating');

  useEffect(() => {
    if (ran.current) return;
    const go = () => {
      setStatus('done');
      router.replace('/knowledge');
    };
    if (hasTenant) {
      ran.current = true;
      migrateContentManager(tenant?.id ?? '').catch(() => undefined).finally(go);
      return;
    }
    // Tenantless (or auth still settling): nothing tenant-scoped to migrate — fall
    // through to /knowledge after a short grace period so we never hang.
    const timer = setTimeout(() => {
      if (!ran.current) {
        ran.current = true;
        go();
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [hasTenant, tenant?.id, router]);

  return (
    <PageContainer>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          minHeight: '40vh',
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}
      >
        <p style={{ margin: 0, fontSize: '0.95rem' }}>
          {status === 'migrating' ? t('migrate.moving') : t('migrate.done')}
        </p>
      </div>
    </PageContainer>
  );
}
