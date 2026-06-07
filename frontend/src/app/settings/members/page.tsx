'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { MembersView } from '@/components/members/MembersView';

/**
 * Workspace members page — thin route shell around the reusable MembersView.
 * Owns the login/tenant redirect guards and the page heading; the member list,
 * invites, and removals live in MembersView (also rendered as the Workforce →
 * Members tab).
 */
export default function MembersPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant, tenant, tenantToken } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/settings/members');
      return;
    }
    if (!hasTenant) {
      router.replace('/tenants?next=/settings/members');
    }
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant || !tenant || !tenantToken) return null;

  return (
    <div style={{ flex: 1, color: 'var(--text-primary)' }}>
      <main className="max-w-4xl mx-auto px-4 py-6" style={{ fontFamily: 'var(--font-display)' }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 6 }}>Workspace members</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Invite teammates into <strong>{tenant.name}</strong> and manage who has access.
          </p>
        </header>

        <MembersView />
      </main>
    </div>
  );
}
