/**
 * /insights/snapshots — the "Review snapshots" hub surface.
 *
 * Renders the persona chip (view-shaping affordance) + the periodic lens-snapshot
 * review panel, gated behind the manager insight capability (disabled, not hidden).
 *
 * A server component: the heading is translated on the server (so it arrives in
 * the visitor's locale rather than swapping after hydration), and the only client
 * code below it is the guard boundary and the two panels that genuinely fetch.
 */
import { getTranslations } from 'next-intl/server';
import { RequireAuth } from '@/components/auth/RequireAuth';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { PersonaLensChip } from '@/components/insights/PersonaLensChip';
import { LensSnapshotsPanel } from '@/components/insights/LensSnapshotsPanel';

// getTranslations reads the locale cookie, which makes the route per-request.
export const runtime = 'edge';

export default async function LensSnapshotsHubPage() {
  const t = await getTranslations('lensSnapshots');

  return (
    <RequireAuth>
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
    </RequireAuth>
  );
}
