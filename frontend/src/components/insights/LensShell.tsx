'use client';

import { useEffect, type ReactNode } from 'react';
import { Select } from '@/components/Select';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import type { Capability } from '@/lib/rbac';

/**
 * Shared chrome for every role-insight lens page (DRY: one place owns the auth
 * guard, the page header, and the capability gate). A lens page is then just
 * `<LensPage capability=… titleKey=… subtitleKey=…><TheLens/></LensPage>`.
 *
 * Access is decided by <RoleGate> (disable + "Requires <Role>" hint, never
 * hidden) — the server requireRole() on /api/insights/* is the real authority.
 */
export function LensPage({
  capability, titleKey, subtitleKey, children,
}: {
  capability: Capability;
  titleKey: string;
  subtitleKey: string;
  children: ReactNode;
}) {
  const t = useTranslations('insights');
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
    else if (!hasTenant) router.replace('/tenants');
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;

  return (
    <PageContainer>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{t(titleKey)}</h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>{t(subtitleKey)}</p>
      </div>
      <RoleGate capability={capability} variant="block">
        {children}
      </RoleGate>
    </PageContainer>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};

/** Shared 7/30/90-day window selector used by the time-windowed lenses. */
export function DaysWindowSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const t = useTranslations('insights');
  return (
    <Select style={selectStyle} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={t('window')}>
      <option value={7}>{t('days', { n: 7 })}</option>
      <option value={30}>{t('days', { n: 30 })}</option>
      <option value={90}>{t('days', { n: 90 })}</option>
    </Select>
  );
}

/** Shared KPI grid (auto-fit). Children are pmShared <StatCard/>s. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
      {children}
    </div>
  );
}
