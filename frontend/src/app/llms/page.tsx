'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { MyLlmsPanel } from '@/components/llm/MyLlmsPanel';

/**
 * My LLMs page — manage the tenant's named model configs ("LLMs"). Reachable from
 * the IDE dashboard. The configs created here are usable by any cloud agent,
 * self-hosted agent, or the Designer Brain via their `tenant_model:<slug>` ref.
 */
export default function LlmsPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login?next=/llms');
    else if (!hasTenant) router.replace('/tenants?next=/llms');
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;

  return (
    <div style={{ flex: 1, color: 'var(--text-primary)' }}>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>LLMs</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: 14 }}>
            Create reusable model configs your agents and the IDE can run.
          </p>
        </div>
        <MyLlmsPanel />
      </main>
    </div>
  );
}
