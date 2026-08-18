'use client';

import { useRequireAuth } from '@/lib/useRequireAuth';
import { GrowthClient } from './GrowthClient';

/**
 * Thin auth-guarded page that delegates to the client component (mirrors the
 * alerts page pattern). Manager-only actions are gated inside GrowthClient — the
 * page itself is readable by any tenant member.
 */
export default function GrowthPage() {
  const allowed = useRequireAuth();

  if (!allowed) return null;
  return <GrowthClient />;
}
