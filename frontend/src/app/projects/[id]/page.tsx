'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export const runtime = 'edge';

/**
 * /projects/[id] no longer opens the IDE. Redirect to /ide/[id] so the IDE
 * is only reachable at /ide/{id}.
 */
export default function ProjectPageRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';

  useEffect(() => {
    if (id) {
      router.replace(`/ide/${id}`);
    } else {
      router.replace('/projects');
    }
  }, [id, router]);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
        color: 'var(--text-secondary)',
        gap: 16,
        fontFamily: 'var(--font-display)',
      }}
    >
      <div style={{ fontSize: '2.5rem', animation: 'pulse 1.5s ease-in-out infinite' }}>⚡</div>
      <p>Redirecting to IDE…</p>
    </div>
  );
}
