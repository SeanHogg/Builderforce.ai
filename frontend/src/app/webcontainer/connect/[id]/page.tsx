'use client';

export const runtime = 'edge';

import { useEffect, useState } from 'react';

/**
 * WebContainer "connect" page. When the user opens the preview URL in a new tab,
 * that tab redirects to this URL (e.g. /webcontainer/connect/61636aac). This page
 * must run setupConnect() from @webcontainer/api so the new tab can communicate
 * with the parent IDE. This route MUST be served with Cross-Origin-Embedder-Policy: unsafe-none
 * (see next.config.js).
 * @see https://github.com/stackblitz/webcontainer-core/issues/1725
 */
export default function WebContainerConnectPage() {
  const [status, setStatus] = useState<'connecting' | 'ok' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { setupConnect } = await import('@webcontainer/api/connect');
        setupConnect({ editorOrigin: typeof window !== 'undefined' ? window.location.origin : undefined });
        if (!cancelled) setStatus('ok');
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (status === 'ok') {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui', fontSize: 14, color: '#666' }}>
        Connected. You can close this tab if the preview is showing in your IDE.
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui', fontSize: 14, color: '#c00' }}>
        Connection failed: {error}
      </div>
    );
  }
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui', fontSize: 14, color: '#666' }}>
      Connecting to IDE…
    </div>
  );
}
