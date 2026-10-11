/**
 * Stable CDN loader — `https://cdn.builderforce.ai/replay/v1/loader.js`.
 *
 * Reads `data-builderforce-key` (or `data-key`) on the script tag, fetches
 * `/replay/manifest.json`, injects the hashed recorder. Kept tiny on purpose
 * (gzip ≤ 8 KB). Fail closed: a missing key or a failed fetch is silence.
 */

const CDN = 'https://cdn.builderforce.ai';

interface Manifest {
  recorder: string;
}

function scriptEl(): HTMLScriptElement | null {
  return document.currentScript as HTMLScriptElement | null;
}

function siteKey(script: HTMLScriptElement | null): string {
  if (!script) return '';
  return script.getAttribute('data-builderforce-key') || script.getAttribute('data-key') || '';
}

function inject(src: string, onload: () => void): void {
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.onload = onload;
  (document.head || document.documentElement).appendChild(s);
}

export function boot(opts?: { cdn?: string; fetchFn?: typeof fetch }): void {
  const cdn = (opts?.cdn ?? CDN).replace(/\/$/, '');
  const fetchFn = opts?.fetchFn ?? fetch;
  const key = siteKey(scriptEl());
  if (!key) return;
  void fetchFn(`${cdn}/replay/manifest.json`, { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : null))
    .then((m: Manifest | null) => {
      if (!m?.recorder) return;
      const src = m.recorder.startsWith('http') ? m.recorder : `${cdn}${m.recorder.startsWith('/') ? '' : '/'}${m.recorder}`;
      inject(src, () => {
        const rec = (window as unknown as {
          BuilderForceReplayRecorder?: { init: (o: { key: string }) => void };
        }).BuilderForceReplayRecorder;
        rec?.init({ key });
      });
    })
    .catch(() => {
      /* fail closed */
    });
}

if (typeof document !== 'undefined') boot();
