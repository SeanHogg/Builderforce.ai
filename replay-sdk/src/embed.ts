/**
 * Hosted-app snippet at `https://cdn.builderforce.ai/embed/v1.js`.
 *
 * `unifiedEmbedSnippet()` already emits this URL. There is no separate
 * hosted-app runtime bundle yet, so this file IS the runtime: it installs
 * `window.BuilderForce.session` and boots the hashed replay recorder from
 * `/replay/manifest.json` using `data-builderforce-key`. Fail closed.
 *
 * Hosted-app surfaces (flags, forms) can attach to the same global later
 * without changing the snippet URL.
 */
import { installGlobal, session } from './publicApi';

const DEFAULT_CDN = 'https://cdn.builderforce.ai';

function currentScript(): HTMLScriptElement | null {
  if (typeof document === 'undefined') return null;
  return (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-builderforce-key],script[src*="embed/v1"]');
}

function readKey(script: HTMLScriptElement | null): string {
  if (!script) return '';
  return script.getAttribute('data-builderforce-key') || script.getAttribute('data-key') || '';
}

function cdnOrigin(script: HTMLScriptElement | null): string {
  const attr = script?.getAttribute('data-cdn');
  if (attr) return attr.replace(/\/$/, '');
  const src = script?.src;
  if (src) {
    try {
      return new URL(src).origin;
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_CDN;
}

function bootRecorder(cdn: string, key: string): void {
  if (typeof document === 'undefined' || !key) return;
  fetch(`${cdn}/replay/manifest.json`, { credentials: 'omit' })
    .then((res) => (res.ok ? res.json() : null))
    .then((m: { recorder?: string; hash?: string } | null) => {
      if (!m?.recorder) return;
      const url = m.recorder.startsWith('http') ? m.recorder : `${cdn}${m.recorder}`;
      const s = document.createElement('script');
      s.async = true;
      s.src = url;
      s.dataset.key = key;
      if (m.hash) s.dataset.hash = m.hash;
      document.head.appendChild(s);
    })
    .catch(() => {
      /* fail closed */
    });
}

installGlobal();
const script = currentScript();
const key = readKey(script);
if (key) session.init({ key, cdn: cdnOrigin(script) });
bootRecorder(cdnOrigin(script), key);
