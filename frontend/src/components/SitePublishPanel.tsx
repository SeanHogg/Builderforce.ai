'use client';

/**
 * Designer "Publish" panel — deploy the built app to a subdomain.
 *
 * The heavy lifting (mount → install → `npm run build` → capture dist) is the
 * `onBuild` callback supplied by the IDE (it owns the file contents + the
 * WebContainer). This panel owns the subdomain UI, the upload, and the result.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchSite, publishSite, type SiteInfo } from '@/lib/api';

interface SitePublishPanelProps {
  projectId: number;
  projectName: string;
  /** Build the project and return its dist assets (path is dist-relative). */
  onBuild: () => Promise<Array<{ path: string; data: Uint8Array }>>;
}

/** Best-effort client-side slug, mirroring the server's normalizeSubdomain rules. */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type Phase = 'idle' | 'building' | 'uploading' | 'done' | 'error';

export function SitePublishPanel({ projectId, projectName, onBuild }: SitePublishPanelProps) {
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [subdomain, setSubdomain] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSite(projectId)
      .then((s) => {
        if (cancelled) return;
        setSite(s);
        setSubdomain(s?.subdomain ?? slugify(projectName) ?? `app-${projectId}`);
      })
      .catch(() => { if (!cancelled) setSubdomain(slugify(projectName) ?? `app-${projectId}`); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [projectId, projectName]);

  const handlePublish = useCallback(async () => {
    const slug = slugify(subdomain);
    if (!slug) { setError('Enter a valid subdomain (letters, numbers, hyphens).'); return; }
    setError('');
    setPhase('building');
    try {
      const assets = await onBuild();
      setPhase('uploading');
      const result = await publishSite(projectId, assets, slug);
      setSite({
        subdomain: result.subdomain,
        mode: 'static',
        status: 'active',
        versionToken: result.versionToken,
        assetCount: result.assetCount,
        totalBytes: result.totalBytes,
        publishedAt: new Date().toISOString(),
        url: result.url,
        pathUrl: result.pathUrl,
      });
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
      setPhase('error');
    }
  }, [subdomain, onBuild, projectId]);

  const busy = phase === 'building' || phase === 'uploading';
  // Mirrors HOSTING_APEX (api/src/application/ide/siteHosting.ts) — display only;
  // the live URLs come from the server (site.url / pathUrl).
  const apex = 'builderforce.ai';

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, color: 'var(--text-primary)', fontSize: 14 }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>🚀 Publish to the web</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 2 }}>
          Build this app and host it at a subdomain. Static hosting — your app runs in the browser.
        </div>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Subdomain</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value)}
            disabled={busy || !loaded}
            placeholder="my-app"
            spellCheck={false}
            style={{
              flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--chat-input-border)', background: 'var(--chat-input-bg)',
              color: 'var(--text-primary)', fontSize: 14, fontFamily: 'var(--font-mono, monospace)',
            }}
          />
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>.{apex}</span>
        </div>
      </label>

      <button
        type="button"
        onClick={handlePublish}
        disabled={busy || !loaded}
        style={{
          padding: '10px 14px', borderRadius: 8, border: 'none', cursor: busy ? 'wait' : 'pointer',
          background: busy ? 'var(--chat-input-disabled-send-bg)' : 'var(--surface-coral, #e2654a)',
          color: '#fff', fontWeight: 600, fontSize: 14,
        }}
      >
        {phase === 'building' ? 'Building…' : phase === 'uploading' ? 'Uploading…' : site ? 'Re-publish' : 'Publish'}
      </button>

      {error && (
        <div style={{ color: 'var(--text-error, #c0392b)', fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{error}</div>
      )}

      {site && phase !== 'building' && phase !== 'uploading' && (
        <div style={{ borderTop: '1px solid var(--chat-input-border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {phase === 'done' ? 'Published ✓' : 'Live site'}
          </div>
          <a href={site.url} target="_blank" rel="noreferrer" style={{ color: 'var(--surface-coral, #e2654a)', fontWeight: 600, wordBreak: 'break-all' }}>
            {site.url}
          </a>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {site.assetCount} files · {formatBytes(site.totalBytes)}
            {' · '}
            {/* Path form works today, before the wildcard DNS/route is wired. */}
            <a href={site.pathUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>
              preview
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
