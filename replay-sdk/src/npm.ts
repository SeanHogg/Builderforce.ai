/**
 * npm entry self-update — fetch the CDN manifest; if the hashed recorder is
 * newer than this package, inject it. Otherwise run the bundled recorder.
 *
 * Fail closed on network errors: the bundled recorder still starts.
 */

import { startRecorder } from './recorder';
import { installGlobal, session, type ReplayInit } from './publicApi';

const CDN = 'https://cdn.builderforce.ai';

/** Replaced by `scripts/emit-assets.mjs` after tsup. Empty in unit tests. */
export const BUNDLED_RECORDER_HASH = '__BF_RECORDER_HASH__';

export async function initFromCdn(opts: ReplayInit): Promise<void> {
  installGlobal();
  session.init(opts);
  const cdn = (opts.cdn ?? CDN).replace(/\/$/, '');
  try {
    const res = await fetch(`${cdn}/replay/manifest.json`, { credentials: 'omit' });
    if (res.ok) {
      const manifest = (await res.json()) as { recorder?: string; hash?: string };
      const hash = manifest.hash ?? '';
      if (hash && hash !== BUNDLED_RECORDER_HASH && manifest.recorder) {
        await inject(manifest.recorder.startsWith('http') ? manifest.recorder : `${cdn}${manifest.recorder}`);
        const rec = (window as unknown as { BuilderForceReplayRecorder?: { init: (o: ReplayInit) => void } })
          .BuilderForceReplayRecorder;
        rec?.init(opts);
        return;
      }
    }
  } catch {
    /* bundled fallback */
  }
  startRecorder(opts);
}

function inject(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('recorder inject failed'));
    (document.head || document.documentElement).appendChild(s);
  });
}
