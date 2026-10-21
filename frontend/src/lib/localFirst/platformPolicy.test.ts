// @vitest-environment jsdom
/**
 * THE DENIED DEFAULT, PROVED (G01) — and the inference mode that derives from it.
 *
 * Signed out and never asked = Local only = every capability refused. Signed in
 * and never asked = Hybrid. A stored mode and stored grants are the person's.
 *
 * Every assertion here is about what does NOT happen: a browser that has never
 * been asked must reach the platform with nothing open, and the only states that
 * may change that — an explicit choice, restored on the next load — are the
 * person's. The first two tests are the ones that would have caught the previous
 * behaviour: boot with empty storage applied a connected-grants fallback, so a
 * signed-in visitor on a fresh profile was silently synced, authenticated, and
 * able to pull models without ever having been asked.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { API_ORIGIN } from '../apiOrigin';
import {
  WEB_PLATFORM_POLICY_BOOTED,
  WEB_PLATFORM_POLICY_STORAGE_KEY,
  bootWebPlatformPolicy,
  refreshWebPlatformPolicy,
  resetWebPlatformPolicyForTests,
  setWebInferenceMode,
  webInferencePolicyFor,
  webPlatformCapabilityFor,
  webPlatformFetch,
  webPlatformPolicy,
  webSignedIn,
} from './platformPolicy';
import { WEB_INFERENCE_MODE_STORAGE_KEY, subscribeWebInferenceMode } from './webInferenceMode';

/** The mode in force for this tab, and whether the person chose it. */
function webInferenceMode(): { mode: string; chosen: boolean } {
  const { mode, chosen } = webInferencePolicyFor(webSignedIn());
  return { mode, chosen };
}

/** A stored advanced override — what the retired per-capability switches wrote. */
function storeGrants(grants: Record<string, boolean>): void {
  window.localStorage.setItem(WEB_PLATFORM_POLICY_STORAGE_KEY, JSON.stringify(grants));
}

/** The full snapshot, as plain booleans so a denied/allowed pair is comparable. */
function snapshot(): Record<string, boolean> {
  return { ...webPlatformPolicy().snapshot() };
}

const ALL_REFUSED = {
  synchronize: false,
  gatewayInference: false,
  connectedFeatures: false,
  authenticate: false,
  modelDownloads: false,
  directProviders: false,
  externalMcp: false,
  gitRemotes: false,
};

beforeEach(() => {
  window.localStorage.clear();
  resetWebPlatformPolicyForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the web platform policy refuses by default', () => {
  it('boots to every capability refused when the person has never been asked', () => {
    bootWebPlatformPolicy();

    const policy = webPlatformPolicy();
    expect(Object.values(policy.snapshot()).every((on) => on === false)).toBe(true);
    expect(policy.allows('synchronize')).toBe(false);
    expect(policy.allows('gateway-inference')).toBe(false);
    expect(policy.allows('connected-feature')).toBe(false);
    expect(policy.allows('authenticate')).toBe(false);
    expect(policy.allows('model-download')).toBe(false);
    // Among the four the deleted connected-grants list handed out for free.
    expect(policy.allows('direct-provider')).toBe(false);
  });

  it('grants nothing merely because the profile is on a machine that is online', () => {
    // Reaching the boot path is not a decision, and neither is being signed in
    // on a working network — the old fallback treated both as though they were.
    bootWebPlatformPolicy();
    expect(snapshot()).toEqual(ALL_REFUSED);
  });

  it('restores an explicit choice on the next load, and only what was chosen', () => {
    // Local only (the mode a signed-out person chose) keeps sync off whatever is
    // granted; Hybrid (signed in, never asked) keeps it per its own grant.
    window.localStorage.setItem(WEB_INFERENCE_MODE_STORAGE_KEY, 'hybrid');
    storeGrants({ synchronize: true });
    resetWebPlatformPolicyForTests(); // A reload: no in-memory state carries over.

    bootWebPlatformPolicy();
    expect(webPlatformPolicy().allows('synchronize')).toBe(true);
    // A choice about one capability is not a choice about the ones the mode leaves alone.
    expect(webPlatformPolicy().allows('model-download')).toBe(false);
    expect(webPlatformPolicy().allows('direct-provider')).toBe(false);
  });

  it('follows an override removed in another tab, and comes back refused after a reload', () => {
    window.localStorage.setItem(WEB_INFERENCE_MODE_STORAGE_KEY, 'hybrid');
    storeGrants({ synchronize: true });
    bootWebPlatformPolicy();
    expect(webPlatformPolicy().allows('synchronize')).toBe(true);

    // Another tab chose Local only and dropped the override; this tab sees the events.
    window.localStorage.removeItem(WEB_PLATFORM_POLICY_STORAGE_KEY);
    window.localStorage.setItem(WEB_INFERENCE_MODE_STORAGE_KEY, 'local-only');
    window.dispatchEvent(new StorageEvent('storage', { key: WEB_PLATFORM_POLICY_STORAGE_KEY, newValue: null }));
    expect(webPlatformPolicy().allows('synchronize')).toBe(false);
    expect(webInferenceMode()).toEqual({ mode: 'local-only', chosen: true });

    resetWebPlatformPolicyForTests();
    bootWebPlatformPolicy();
    expect(snapshot()).toEqual(ALL_REFUSED);
  });
});

describe('the inference mode', () => {
  it('a signed-in person who never chose runs Hybrid — chat, connected features, no sync', () => {
    window.localStorage.setItem('bf_web_token', 'present');
    bootWebPlatformPolicy();
    expect(webInferenceMode()).toEqual({ mode: 'hybrid', chosen: false });
    const policy = webPlatformPolicy();
    expect(policy.allows('gateway-inference')).toBe(true);
    expect(policy.allows('connected-feature')).toBe(true);
    expect(policy.allows('synchronize')).toBe(false);
  });

  it('follows sign-in and sign-out in this tab when the auth provider re-applies it', () => {
    bootWebPlatformPolicy();
    expect(webInferenceMode().mode).toBe('local-only');
    window.localStorage.setItem('bf_web_token', 'present');
    refreshWebPlatformPolicy();
    expect(webInferenceMode().mode).toBe('hybrid');
    expect(webPlatformPolicy().allows('gateway-inference')).toBe(true);
    window.localStorage.removeItem('bf_web_token');
    refreshWebPlatformPolicy();
    expect(snapshot()).toEqual(ALL_REFUSED);
  });

  it('a guest session token is NOT signed in — an anonymous visitor stays Local only until they choose Hybrid', () => {
    expect(webSignedIn()).toBe(false);
    window.localStorage.setItem('bf_guest_token', 'guest');
    window.localStorage.setItem('bf_guest_token_exp', String(Date.now() + 3_600_000));
    expect(webSignedIn()).toBe(false);
    bootWebPlatformPolicy();
    expect(webInferenceMode()).toEqual({ mode: 'local-only', chosen: false });
    expect(webPlatformPolicy().allows('gateway-inference')).toBe(false);
    // The opt-in is the stored mode, not the token.
    setWebInferenceMode('hybrid');
    expect(webInferenceMode()).toEqual({ mode: 'hybrid', chosen: true });
    expect(webPlatformPolicy().allows('gateway-inference')).toBe(true);
  });

  it('Local only locks the gateway, connected features and sync even with stored grants', () => {
    window.localStorage.setItem('bf_web_token', 'present');
    window.localStorage.setItem(
      WEB_PLATFORM_POLICY_STORAGE_KEY,
      JSON.stringify({ synchronize: true, gatewayInference: true, connectedFeatures: true, directProviders: true }),
    );
    bootWebPlatformPolicy();
    setWebInferenceMode('local-only');
    const policy = webPlatformPolicy();
    expect(policy.allows('gateway-inference')).toBe(false);
    expect(policy.allows('connected-feature')).toBe(false);
    expect(policy.allows('synchronize')).toBe(false);
    expect(policy.allows('direct-provider')).toBe(false);
  });

  it('persists the choice across a reload and mirrors it from another tab', () => {
    window.localStorage.setItem('bf_web_token', 'present');
    bootWebPlatformPolicy();
    const heard = vi.fn();
    const stop = subscribeWebInferenceMode(heard);
    setWebInferenceMode('specific');
    expect(heard).toHaveBeenCalled();
    expect(webPlatformPolicy().allows('direct-provider')).toBe(true);

    resetWebPlatformPolicyForTests();
    bootWebPlatformPolicy();
    expect(webInferenceMode()).toEqual({ mode: 'specific', chosen: true });

    // Another tab chose Local only.
    window.localStorage.setItem(WEB_INFERENCE_MODE_STORAGE_KEY, 'local-only');
    window.dispatchEvent(new StorageEvent('storage', { key: WEB_INFERENCE_MODE_STORAGE_KEY, newValue: 'local-only' }));
    expect(webInferenceMode().mode).toBe('local-only');
    expect(webPlatformPolicy().allows('gateway-inference')).toBe(false);
    stop();
  });

  it('a sign-out in another tab moves an undecided person back to Local only', () => {
    window.localStorage.setItem('bf_web_token', 'present');
    bootWebPlatformPolicy();
    expect(webInferenceMode().mode).toBe('hybrid');
    window.localStorage.removeItem('bf_web_token');
    window.dispatchEvent(new StorageEvent('storage', { key: 'bf_web_token', newValue: null }));
    expect(webInferenceMode().mode).toBe('local-only');
    expect(snapshot()).toEqual(ALL_REFUSED);
  });
});

describe('the platform transport', () => {
  it('blocks a denied capability before any request is attempted', async () => {
    bootWebPlatformPolicy();
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    await expect(webPlatformFetch(`${API_ORIGIN}/api/sync/push`, { method: 'POST' })).rejects.toThrow();

    // The point of the block: nothing left the browser.
    expect(spy).not.toHaveBeenCalled();
  });

  it('issues the request once the capability is granted', async () => {
    window.localStorage.setItem(WEB_INFERENCE_MODE_STORAGE_KEY, 'hybrid');
    storeGrants({ synchronize: true });
    bootWebPlatformPolicy();
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    const response = await webPlatformFetch(`${API_ORIGIN}/api/sync/push`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('the origin classifier', () => {
  it('judges the platform API as platform', () => {
    expect(webPlatformCapabilityFor(`${API_ORIGIN}/api/auth/login`)).toBe('authenticate');
    expect(webPlatformCapabilityFor(`${API_ORIGIN}/v1/chat/completions`)).toBe('gateway-inference');
    expect(webPlatformCapabilityFor(`${API_ORIGIN}/api/projects`)).toBe('connected-feature');
    expect(webPlatformCapabilityFor(`${API_ORIGIN}/api/sync/push`, { method: 'POST' })).toBe('synchronize');
    // A read-style POST is a connected feature (the shared route table), not a write.
    expect(webPlatformCapabilityFor(`${API_ORIGIN}/api/limbic/block`, { method: 'POST' })).toBe('connected-feature');
  });

  it("leaves a third-party host to that host's own declared policy", () => {
    expect(webPlatformCapabilityFor('https://models.example.com/v1/chat/completions')).toBeNull();
    expect(webPlatformCapabilityFor('https://cdn.example.com/assets/app.js')).toBeNull();
  });

  it('judges a same-origin URL, so a relative sync call still passes the gate', () => {
    // Sync calls the app's own endpoints, so a relative request resolving to the
    // page origin is the app talking to itself. Dropping the page origin from the
    // set would classify every relative request as non-platform — which
    // webPlatformFetch reads as "not the platform's business" and skips.
    expect(webPlatformCapabilityFor('/api/sync/push', { method: 'POST' })).toBe('synchronize');
    expect(webPlatformCapabilityFor('/api/projects')).toBe('connected-feature');
  });
});

const frontendSrc = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function source(relativePath: string): string {
  return readFileSync(resolve(frontendSrc, relativePath), 'utf8');
}

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('the web boot path calls the denied default before any platform fetch', () => {
  it('mounts the boot and holds platform-origin fetch until that call finishes', () => {
    const layout = source('app/layout.tsx');
    const boot = withoutComments(source('components/PlatformPolicyBoot.tsx'));
    const holdAt = layout.indexOf('__html: PLATFORM_POLICY_BOOT_HOLD');
    const bodyAt = layout.indexOf('<body>');
    const mountAt = layout.indexOf('<PlatformPolicyBoot />');
    const authAt = layout.indexOf('<AuthProvider>');

    expect(layout).toContain('name="bf-api-origin"');
    expect(layout.indexOf('name="bf-api-origin"')).toBeLessThan(holdAt);
    expect(holdAt).toBeGreaterThan(-1);
    expect(holdAt).toBeLessThan(bodyAt);
    expect(mountAt).toBeGreaterThan(-1);
    expect(mountAt).toBeLessThan(authAt);
    // Module evaluation, not an effect: removing this call, or deferring it, fails here.
    expect(boot.indexOf('bootWebPlatformPolicy()')).toBeGreaterThan(-1);
    expect(boot.indexOf('bootWebPlatformPolicy()')).toBeLessThan(boot.indexOf('export function PlatformPolicyBoot'));
    expect(boot).not.toContain('useEffect');
    expect(layout).toContain(WEB_PLATFORM_POLICY_BOOTED);
  });

  function evalHoldScript(): void {
    const layout = source('app/layout.tsx');
    const script = layout.match(/const PLATFORM_POLICY_BOOT_HOLD = `([\s\S]*?)`;/)?.[1];
    expect(script).toBeTruthy();
    expect(script).not.toContain('fetch(');
    // The head script is what a fresh document runs before the policy chunk.
    // eslint-disable-next-line no-eval
    eval(script as string);
  }

  it('holds a platform fetch that races the chunk, then lets the booted policy decide it', async () => {
    document.head.insertAdjacentHTML('afterbegin', `<meta name="bf-api-origin" content="${API_ORIGIN}">`);
    const native = vi.fn(async () => new Response('ok', { status: 200 }));
    const previous = window.fetch;
    window.fetch = native as unknown as typeof fetch;
    try {
      evalHoldScript();
      let settled = false;
      const held = window.fetch(`${API_ORIGIN}/api/sync/push`, { method: 'POST' }).then((response) => {
        settled = true;
        return response;
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Held, not rejected and not sent.
      expect(settled).toBe(false);
      expect(native).not.toHaveBeenCalled();
      await window.fetch('https://example.com/asset.js');
      expect(native).toHaveBeenCalledTimes(1);

      bootWebPlatformPolicy();
      expect((window as unknown as Record<string, boolean>)[WEB_PLATFORM_POLICY_BOOTED]).toBe(true);
      expect(webPlatformPolicy().allows('synchronize')).toBe(false);
      expect(webPlatformPolicy().allows('authenticate')).toBe(false);

      // Released through the current transport once the policy exists.
      await expect(held).resolves.toBeInstanceOf(Response);
      expect(native).toHaveBeenCalledTimes(2);
      await window.fetch(`${API_ORIGIN}/api/sync/push`, { method: 'POST' });
      expect(native).toHaveBeenCalledTimes(3);
    } finally {
      window.fetch = previous;
      document.head.querySelector('meta[name="bf-api-origin"]')?.remove();
    }
  });

  it('fails a held platform fetch closed when the policy never boots', async () => {
    vi.useFakeTimers();
    document.head.insertAdjacentHTML('afterbegin', `<meta name="bf-api-origin" content="${API_ORIGIN}">`);
    const native = vi.fn(async () => new Response('ok', { status: 200 }));
    const previous = window.fetch;
    window.fetch = native as unknown as typeof fetch;
    try {
      evalHoldScript();
      const held = window.fetch(`${API_ORIGIN}/api/projects`);
      const outcome = expect(held).rejects.toThrow(/platform_denied/);
      await vi.advanceTimersByTimeAsync(15_000);
      await outcome;
      expect(native).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      window.fetch = previous;
      document.head.querySelector('meta[name="bf-api-origin"]')?.remove();
    }
  });
});