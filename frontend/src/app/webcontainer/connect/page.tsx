'use client';

export const runtime = 'edge';

import { useEffect, useState } from 'react';

/**
 * WebContainer "connect" page. Must be at exactly /webcontainer/connect (no trailing segment)
 * so that @webcontainer/api's setupConnect() recognises the pathname.
 * This page must be served without COOP: same-origin (see next.config.js).
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
      <div style={{ padding: 24, fontFamily: 'system-ui', fontSize: 14, color: 'var(--text-secondary)' }}>
        Connected. You can close this tab if the preview is showing in your IDE.
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui', fontSize: 14, color: 'var(--error-text)' }}>
        Connection failed: {error}
      </div>
    );
  }
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui', fontSize: 14, color: 'var(--text-secondary)' }}>
      Connecting to IDE…
    </div>
  );
}
