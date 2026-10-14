import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReplayClientConfig } from '@builderforce/interaction-contract';
import { boot } from './loaderBoot';

function tag(data: Record<string, string>): HTMLScriptElement {
  const script = document.createElement('script');
  for (const [k, v] of Object.entries(data)) script.dataset[k] = v;
  document.head.appendChild(script);
  return script;
}

function configFetch(config: ReplayClientConfig | null, ok = true) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok, json: async () => config }) as unknown as Response);
}

function setPrivacy(dnt: string | null, gpc: boolean | undefined): void {
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, get: () => dnt });
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => gpc });
}

const RECORDER = 'https://cdn.builderforce.ai/replay/r/recorder.abcdef123456.js';

afterEach(() => {
  document.querySelectorAll('script').forEach((s) => s.remove());
  delete window.BFReplay;
  delete window.__bfReplay;
  setPrivacy(null, undefined);
});

describe('loader', () => {
  it('fetches config without credentials and injects the named recorder with the hand-off', async () => {
    const fetchFn = configFetch({ enabled: true, recorderUrl: RECORDER, keepRate: 0.5 });
    await boot({ script: tag({ site: 'bfr_abc', release: 'v42', variant: 'B' }), fetchFn });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.builderforce.ai/api/replay-ingest/v1/config?site=bfr_abc',
      { credentials: 'omit' },
    );
    expect(document.querySelector(`script[src="${RECORDER}"]`)).toBeTruthy();
    expect(window.__bfReplay).toMatchObject({ site: 'bfr_abc', release: 'v42', variant: 'B', api: 'https://api.builderforce.ai' });
    expect(window.__bfReplay?.config.keepRate).toBe(0.5);
  });

  it('honours data-api', async () => {
    const fetchFn = configFetch({ enabled: false });
    await boot({ script: tag({ site: 'bfr_abc', api: 'https://api.test/' }), fetchFn });
    expect(fetchFn).toHaveBeenCalledWith('https://api.test/api/replay-ingest/v1/config?site=bfr_abc', { credentials: 'omit' });
  });

  it('makes no network call under Do Not Track', async () => {
    setPrivacy('1', undefined);
    const fetchFn = configFetch({ enabled: true, recorderUrl: RECORDER });
    await boot({ script: tag({ site: 'bfr_abc' }), fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
    // The stub is still there, so page code calling BFReplay never throws.
    expect(() => window.BFReplay?.tag('plan', 'pro')).not.toThrow();
  });

  it('makes no network call under Global Privacy Control', async () => {
    setPrivacy(null, true);
    const fetchFn = configFetch({ enabled: true, recorderUrl: RECORDER });
    await boot({ script: tag({ site: 'bfr_abc' }), fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does nothing without a site key', async () => {
    const fetchFn = configFetch({ enabled: true, recorderUrl: RECORDER });
    await boot({ script: tag({}), fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(window.BFReplay).toBeUndefined();
  });

  it('stops when the site is disabled', async () => {
    await boot({ script: tag({ site: 'bfr_abc' }), fetchFn: configFetch({ enabled: false, recorderUrl: RECORDER }) });
    expect(document.querySelector(`script[src="${RECORDER}"]`)).toBeNull();
    expect(window.__bfReplay).toBeUndefined();
  });

  it('injects the recorder even at keepRate 0 — unkept sessions still roll up', async () => {
    await boot({ script: tag({ site: 'bfr_abc' }), fetchFn: configFetch({ enabled: true, recorderUrl: RECORDER, keepRate: 0 }) });
    expect(document.querySelector(`script[src="${RECORDER}"]`)).toBeTruthy();
  });

  it('waits for consent(true) when the site requires consent', async () => {
    await boot({
      script: tag({ site: 'bfr_abc' }),
      fetchFn: configFetch({ enabled: true, recorderUrl: RECORDER, consentRequired: true }),
    });
    expect(document.querySelector(`script[src="${RECORDER}"]`)).toBeNull();
    window.BFReplay?.consent(false);
    expect(document.querySelector(`script[src="${RECORDER}"]`)).toBeNull();
    window.BFReplay?.consent(true);
    expect(document.querySelector(`script[src="${RECORDER}"]`)).toBeTruthy();
  });

  it('starts at once when consent was given before the config arrived', async () => {
    const script = tag({ site: 'bfr_abc' });
    const pending = boot({ script, fetchFn: configFetch({ enabled: true, recorderUrl: RECORDER, consentRequired: true }) });
    window.BFReplay?.consent(true);
    await pending;
    expect(document.querySelector(`script[src="${RECORDER}"]`)).toBeTruthy();
  });

  it('queues stub calls in order and hands the queue to the recorder', async () => {
    const script = tag({ site: 'bfr_abc' });
    const pending = boot({ script, fetchFn: configFetch({ enabled: true, recorderUrl: RECORDER }) });
    window.BFReplay?.tag('plan', 'pro');
    window.BFReplay?.event('signup started');
    window.BFReplay?.keep();
    await pending;
    expect(window.__bfReplay?.queue).toEqual([
      ['tag', ['plan', 'pro']],
      ['event', ['signup started']],
      ['keep', []],
    ]);
  });

  it('fails closed when the config request fails', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      throw new Error('offline');
    });
    await expect(boot({ script: tag({ site: 'bfr_abc' }), fetchFn })).resolves.toBeUndefined();
    expect(window.__bfReplay).toBeUndefined();
  });
});
