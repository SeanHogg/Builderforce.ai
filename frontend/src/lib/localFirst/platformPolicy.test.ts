// @vitest-environment jsdom
/**
 * THE DENIED DEFAULT, PROVED (G01).
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
  connectAccountSync,
  disconnectWebPlatform,
  resetWebPlatformPolicyForTests,
  webPlatformCapabilityFor,
  webPlatformFetch,
  webPlatformPolicy,
} from './platformPolicy';

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
    connectAccountSync();
    resetWebPlatformPolicyForTests(); // A reload: no in-memory state carries over.

    bootWebPlatformPolicy();
    expect(webPlatformPolicy().allows('synchronize')).toBe(true);
    // Auth is implied by sync (see createPlatformPolicy) — but nothing else was
    // granted: a choice about one capability is not a choice about the rest.
    expect(webPlatformPolicy().allows('gateway-inference')).toBe(false);
    expect(webPlatformPolicy().allows('model-download')).toBe(false);
    expect(webPlatformPolicy().allows('direct-provider')).toBe(false);
  });

  it('treats Connect as the sync grant specifically, not a general one', () => {
    bootWebPlatformPolicy();
    connectAccountSync();

    const policy = webPlatformPolicy();
    expect(policy.allows('synchronize')).toBe(true);
    expect(policy.allows('gateway-inference')).toBe(false);
    expect(policy.allows('connected-feature')).toBe(false);
    expect(policy.allows('model-download')).toBe(false);
  });

  it('follows a disconnect in another tab, and comes back refused after a reload', () => {
    connectAccountSync();
    bootWebPlatformPolicy();
    expect(webPlatformPolicy().allows('synchronize')).toBe(true);

    // Another tab pressed Disconnect. This tab sees the storage event and revokes.
    disconnectWebPlatform();
    window.dispatchEvent(
      new StorageEvent('storage', { key: WEB_PLATFORM_POLICY_STORAGE_KEY, newValue: null }),
    );
    expect(webPlatformPolicy().allows('synchronize')).toBe(false);

    resetWebPlatformPolicyForTests();
    bootWebPlatformPolicy();
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
    bootWebPlatformPolicy();
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    connectAccountSync();

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

  it('rejects a platform fetch that races the chunk, then releases it once boot has applied the denial', async () => {
    const layout = source('app/layout.tsx');
    const script = layout.match(/const PLATFORM_POLICY_BOOT_HOLD = `([\s\S]*?)`;/)?.[1];
    expect(script).toBeTruthy();
    document.head.insertAdjacentHTML('afterbegin', `<meta name="bf-api-origin" content="${API_ORIGIN}">`);
    const native = vi.fn(async () => new Response('ok', { status: 200 }));
    const previous = window.fetch;
    window.fetch = native as unknown as typeof fetch;
    try {
      // The head script is what a fresh document runs before the policy chunk.
      // eslint-disable-next-line no-eval
      eval(script as string);
      await expect(window.fetch(`${API_ORIGIN}/api/sync/push`, { method: 'POST' })).rejects.toThrow(/platform_denied/);
      expect(native).not.toHaveBeenCalled();
      await window.fetch('https://example.com/asset.js');
      expect(native).toHaveBeenCalledTimes(1);

      bootWebPlatformPolicy();
      expect((window as unknown as Record<string, boolean>)[WEB_PLATFORM_POLICY_BOOTED]).toBe(true);
      expect(webPlatformPolicy().allows('synchronize')).toBe(false);
      expect(webPlatformPolicy().allows('authenticate')).toBe(false);

      await window.fetch(`${API_ORIGIN}/api/sync/push`, { method: 'POST' });
      expect(native).toHaveBeenCalledTimes(2);
    } finally {
      window.fetch = previous;
      document.head.querySelector('meta[name="bf-api-origin"]')?.remove();
    }
  });
});