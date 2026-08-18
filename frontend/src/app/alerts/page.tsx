'use client';

import { useRequireAuth } from '@/lib/useRequireAuth';
import { AlertsClient } from './AlertsClient';

/**
 * Thin server-of-the-client page: auth-guards then delegates to the client
 * component (mirrors the surveys page pattern). The manager capability gate lives
 * inside AlertsClient via <RoleGate capability="alerts.manage">.
 */
export default function AlertsPage() {
  const allowed = useRequireAuth();

  if (!allowed) return null;
  return <AlertsClient />;
}
