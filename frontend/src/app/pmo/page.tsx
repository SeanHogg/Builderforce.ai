'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { PmoContent } from '@/components/pm/PmoContent';

/**
 * PMO lens (/pmo) — the portfolio / initiative / OKR cockpit that rolls the
 * existing cost + delivery + DORA + outcome collectors up to the cadence the PMO
 * and C-suite live in. Manager-gated via the insights.portfolio capability
 * (server-enforced on every write); the gate disables-and-indicates rather than
 * hiding, per the product rule.
 */
export default function PmoPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login?next=/pmo');
    else if (!hasTenant) router.replace('/tenants');
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;

  return (
    <PageContainer>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Portfolio (PMO)</h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>
          Roll cost, delivery, DORA, AI-effectiveness and OKR attainment up from projects to initiatives and portfolios.
        </p>
      </div>
      <RoleGate capability="insights.portfolio" variant="block">
        <PmoContent />
      </RoleGate>
    </PageContainer>
  );
}
