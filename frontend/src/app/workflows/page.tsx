'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function WorkflowsPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard?filter=workflow'); }, [router]);
  return <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)' }}>Opening workflow sessions…</main>;
}
