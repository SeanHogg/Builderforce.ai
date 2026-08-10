'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { GrowthClient } from './GrowthClient';

/**
 * Thin auth-guarded page that delegates to the client component (mirrors the
 * alerts page pattern). Manager-only actions are gated inside GrowthClient — the
 * page itself is readable by any tenant member.
 */
export default function GrowthPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
    else if (!hasTenant) router.replace('/tenants');
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;
  return <GrowthClient />;
}
