'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi } from '@/lib/builderforceApi';
import { createLocalCreationSession } from '@/lib/creationSessions';

export const runtime = 'edge';

export default function NewCreationSessionPage() {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();
  const started = useRef(false);
  const [message, setMessage] = useState('Creating your canvas…');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!isAuthenticated || !hasTenant) {
      router.replace(`/create/${createLocalCreationSession('')}`);
      return;
    }
    void creationSessionsApi.create({ title: 'Untitled session' })
      .then(({ session }) => router.replace(`/create/${session.id}`))
      .catch(() => {
        setMessage('Starting safely on this device…');
        router.replace(`/create/${createLocalCreationSession('')}`);
      });
  }, [hasTenant, isAuthenticated, router]);

  return <main style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }}>{message}</main>;
}
