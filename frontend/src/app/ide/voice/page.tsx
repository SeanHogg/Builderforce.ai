'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { VoiceClonePanel } from '@/components/VoiceClonePanel';

export default function IDEVoicePage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login?next=/ide/voice');
    else if (!hasTenant) router.replace('/tenants?next=/ide/voice');
  }, [isAuthenticated, hasTenant, router]);

  if (!isAuthenticated || !hasTenant) return null;

  return (
    <div style={{ flex: 1, color: 'var(--text-primary)', minHeight: '100vh', background: 'var(--bg-deep)' }}>
      <VoiceClonePanel />
    </div>
  );
}
