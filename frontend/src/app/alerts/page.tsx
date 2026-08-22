/**
 * Server page: the auth guard is a client BOUNDARY (`<RequireAuth>`), not a
 * reason for this file to be a client component. The manager capability gate
 * lives inside AlertsClient via <RoleGate capability="alerts.manage">.
 */
import { RequireAuth } from '@/components/auth/RequireAuth';
import { AlertsClient } from './AlertsClient';

export default function AlertsPage() {
  return <RequireAuth><AlertsClient /></RequireAuth>;
}
