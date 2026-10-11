/**
 * Hosted-app embed — `https://cdn.builderforce.ai/embed/v1.js`.
 *
 * Same loader contract as replay (`data-builderforce-key`), plus a `mode`
 * (`app` | `chat`) so a hosted Builderforce app can boot from a snippet.
 * Kept as its own IIFE so a marketing site that only wants replay does not
 * download the app runtime.
 */

const CDN = 'https://cdn.builderforce.ai';

function siteKey(script: HTMLScriptElement | null): string {
  if (!script) return '';
  return script.getAttribute('data-builderforce-key') || script.getAttribute('data-key') || '';
}

export function bootEmbed(opts?: { cdn?: string; fetchFn?: typeof fetch }): void {
  const script = document.currentScript as HTMLScriptElement | null;
  const key = siteKey(script);
  if (!key) return;
  const mode = script?.getAttribute('data-mode') || 'app';
  const cdn = (opts?.cdn ?? CDN).replace(/\/$/, '');
  const fetchFn = opts?.fetchFn ?? fetch;
  void fetchFn(`${cdn}/embed/manifest.json`, { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : null))
    .then((m: { runtime?: string } | null) => {
      if (!m?.runtime) return;
      const s = document.createElement('script');
      s.src = m.runtime.startsWith('http') ? m.runtime : `${cdn}${m.runtime.startsWith('/') ? '' : '/'}${m.runtime}`;
      s.async = true;
      s.dataset.builderforceKey = key;
      s.dataset.mode = mode;
      (document.head || document.documentElement).appendChild(s);
    })
    .catch(() => {
      /* fail closed */
    });
}

if (typeof document !== 'undefined') bootEmbed();
