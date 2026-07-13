'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export const runtime = 'edge';

/**
 * Content Manager has been retired and folded into Knowledge. Individual content
 * pages no longer exist as a distinct surface — send the visitor to Knowledge,
 * where their migrated documents now live (see /content-manager which runs the
 * one-time localStorage → knowledge_documents migration).
 */
export default function ContentManagerItemRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/content-manager');
  }, [router]);
  return null;
}
