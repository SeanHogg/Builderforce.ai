'use client';

import { type ReactNode } from 'react';
import { Select } from '@/components/Select';
import { useTranslations } from 'next-intl';
import { useRequireAuth } from '@/lib/useRequireAuth';
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
  capability, titleKey, subtitleKey, actions, children, gate = true,
}: {
  /**
   * The capability the page's content requires. Optional: the /insights home
   * dashboard has no capability of its own — it shows whichever widgets the user
   * pinned, and each of those self-gates — so it renders the same chrome with no
   * gate rather than borrowing an unrelated lens's capability to satisfy a
   * required prop.
   */
  capability?: Capability;
  titleKey: string;
  subtitleKey: string;
  /** Page-level controls rendered opposite the title (window selector, actions). */
  actions?: ReactNode;
  children: ReactNode;
  /**
   * Wrap children in the capability <RoleGate>. Default true; ignored when no
   * `capability` is given. Set false for hub pages whose children gate themselves
   * per-lens (e.g. the delivery hub, where each drill-down applies its own).
   */
  gate?: boolean;
}) {
  const t = useTranslations('insights');
  const allowed = useRequireAuth();

  if (!allowed) return null;

  return (
    <PageContainer>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, margin: 0 }}>{t(titleKey)}</h1>
          <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)', marginTop: 4 }}>{t(subtitleKey)}</p>
        </div>
        {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
      {capability && gate ? (
        <RoleGate capability={capability} variant="block">
          {children}
        </RoleGate>
      ) : (
        children
      )}
    </PageContainer>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)',
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
