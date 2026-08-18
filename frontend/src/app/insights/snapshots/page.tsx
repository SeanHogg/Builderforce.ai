'use client';

/**
 * /insights/snapshots — the "Review snapshots" hub surface. Standalone route (a
 * new file) so it works without editing the shared insights hub page; the
 * integration note carries the snippet to also link it from /insights.
 *
 * Renders the persona chip (view-shaping affordance) + the periodic lens-snapshot
 * review panel, gated behind the manager insight capability (disabled, not hidden).
 */

import { useTranslations } from 'next-intl';
import { useRequireAuth } from '@/lib/useRequireAuth';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { PersonaLensChip } from '@/components/insights/PersonaLensChip';
import { LensSnapshotsPanel } from '@/components/insights/LensSnapshotsPanel';

export default function LensSnapshotsHubPage() {
  const t = useTranslations('lensSnapshots');
  const allowed = useRequireAuth();

  if (!allowed) return null;

  return (
    <PageContainer>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{t('pageTitle')}</h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>{t('subtitle')}</p>
        </div>
        <PersonaLensChip />
      </div>

      <RoleGate capability="insights.engineering" variant="block">
        <LensSnapshotsPanel />
      </RoleGate>
    </PageContainer>
  );
}
