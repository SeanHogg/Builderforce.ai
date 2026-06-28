'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { QualityDashboard } from './QualityDashboard';
import { QualityCollectorsManager } from './QualityCollectorsManager';

/**
 * Quality surface shell — owns the auth guard, header, and tab routing (the shell
 * tab bar is rendered globally from navGroups; here we read `?tab=` to pick the
 * body). The page body is gated by <RoleGate quality.view> (disable, never hide).
 */
export default function QualityClient() {
  const t = useTranslations('quality');
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();
  const tab = useSearchParams().get('tab') ?? '';

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
    else if (!hasTenant) router.replace('/tenants');
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;

  const isSetup = tab === 'collectors';

  return (
    <PageContainer>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
          {isSetup ? t('setup.title') : t('title')}
        </h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>
          {isSetup ? t('setup.subtitle') : t('subtitle')}
        </p>
      </div>
      <RoleGate capability="quality.view" variant="block">
        {isSetup ? <QualityCollectorsManager /> : <QualityDashboard />}
      </RoleGate>
    </PageContainer>
  );
}
