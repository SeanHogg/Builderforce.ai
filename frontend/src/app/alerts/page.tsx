'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { AlertsClient } from './AlertsClient';

/**
 * Thin server-of-the-client page: auth-guards then delegates to the client
 * component (mirrors the surveys page pattern). The manager capability gate lives
 * inside AlertsClient via <RoleGate capability="alerts.manage">.
 */
export default function AlertsPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
    else if (!hasTenant) router.replace('/tenants');
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;
  return <AlertsClient />;
}
