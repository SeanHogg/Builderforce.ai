/**
 * Server page that auth-guards through the shared `<RequireAuth>` boundary
 * (mirrors /alerts). Manager-only actions are gated inside GrowthClient — the
 * page itself is readable by any tenant member.
 */
import { RequireAuth } from '@/components/auth/RequireAuth';
import { GrowthClient } from './GrowthClient';

export default function GrowthPage() {
  return <RequireAuth><GrowthClient /></RequireAuth>;
}
