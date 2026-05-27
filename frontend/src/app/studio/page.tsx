'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStoredTenantToken } from '@/lib/auth';
import { getApiBaseUrl } from '@/lib/apiClient';
import { StudioPanel } from '@seanhogg/builderforce-studio';
import '@seanhogg/builderforce-studio/styles.css';

/**
 * /studio — AI Video Studio workspace.
 *
 * Opens as a single "Video Project" page: prompt input at the top, generate
 * to produce an MP4 entirely client-side via WebGPU / WebNN. No project list
 * for v0 — one workspace, one task.
 *
 * The StudioPanel decides its own hardware support and rendering; this page
 * is only responsible for auth + the tenant token.
 */
export const runtime = 'edge';

export default function StudioPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();
  const [tenantToken, setTenantToken] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login?next=/studio');
    } else if (!hasTenant) {
      router.replace('/tenants?next=/studio');
    } else {
      setTenantToken(getStoredTenantToken());
    }
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant || !tenantToken) return null;

  return (
    <div style={{ flex: 1, padding: 24, background: 'var(--bg-deep)', minHeight: '100vh' }}>
      <StudioPanel apiKey={tenantToken} baseUrl={getApiBaseUrl()} />
    </div>
  );
}
