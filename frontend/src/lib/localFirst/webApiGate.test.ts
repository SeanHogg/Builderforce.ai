// @vitest-environment jsdom
/**
 * THE WEB API GATE (`assertWebApiRequest`, called by `apiClient`'s one transport): the
 * person's inference mode decides what leaves for the platform, exactly as the VS Code
 * host's and Rovr's guards do. The regression: on Local only the web still POSTed the
 * memory recall (the prompt text) and the personality block (the psychometric profile).
 *
 * Under Local only neither request is FETCHED — blocked before it exists — and neither
 * surfaces an error: recall answers "no recalled memory" and the block answers ''. Under
 * Hybrid both go.
 *
 * Local only refuses CONTENT (the shared table's `content` tag) and gateway inference —
 * credentialed and anonymous alike — and lets the page's ordinary reads and writes
 * through, so the app keeps loading. Error reports are dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The on-device answer tier is not under test; keep its WebGPU loader out of jsdom.
vi.mock('../semantic-cache', () => ({ getOnDeviceAnswerMemory: async () => null }));

import { API_ORIGIN } from '../apiOrigin';
import { projectBrainMemoryHooks } from '../brainMemoryHooks';
import { fetchPersonalityBlock } from '../personalityApi';
import { reportBackgroundFailure } from '../reportError';
import type { PsychometricProfile } from '../psychometric';
import { WEB_INFERENCE_MODE_STORAGE_KEY } from './webInferenceMode';
import { resetWebPlatformPolicyForTests, webApiRequestRefusal, webPlatformRequestAccount } from './platformPolicy';

const profile = { traits: { openness: 0.8 } } as unknown as PsychometricProfile;

let fetchSpy: ReturnType<typeof vi.fn>;

function signInAs(mode: 'local-only' | 'hybrid'): void {
  window.localStorage.setItem('bf_tenant_token', 'tenant-token');
  window.localStorage.setItem(WEB_INFERENCE_MODE_STORAGE_KEY, mode);
}

const fetchedPaths = (): string[] => fetchSpy.mock.calls.map(([input]) => new URL(String(input)).pathname);

beforeEach(() => {
  window.localStorage.clear();
  resetWebPlatformPolicyForTests();
  fetchSpy = vi.fn(async (input: unknown) => {
    const path = new URL(String(input)).pathname;
    const body = path.endsWith('/recall') ? { hits: [{ text: 'remembered' }] } : { block: 'tone', personaBlock: '' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('Local only on the web', () => {
  it('never fetches the memory recall, and answers "no recalled memory" without an error', async () => {
    signInAs('local-only');
    const hooks = projectBrainMemoryHooks(12, 7)!;
    await expect(hooks.recall!('what did we decide?')).resolves.toBeNull();
    expect(fetchedPaths()).not.toContain('/api/projects/12/evermind/recall');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(webPlatformRequestAccount().blocked).toBeGreaterThan(0);
  });

  it('never fetches the personality block, and answers an empty block without an error', async () => {
    signInAs('local-only');
    await expect(fetchPersonalityBlock(profile)).resolves.toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Hybrid on the web', () => {
  it('fetches the memory recall', async () => {
    signInAs('hybrid');
    const hooks = projectBrainMemoryHooks(12, 7)!;
    await hooks.recall!('what did we decide?');
    expect(fetchedPaths()).toContain('/api/projects/12/evermind/recall');
  });

  it('fetches the personality block', async () => {
    signInAs('hybrid');
    await expect(fetchPersonalityBlock(profile)).resolves.toBe('tone');
    expect(fetchedPaths()).toContain('/api/limbic/block');
  });
});

describe('what the gate never refuses', () => {
  it('signing in, and an anonymous visitor on the derived Local only', () => {
    window.localStorage.setItem(WEB_INFERENCE_MODE_STORAGE_KEY, 'local-only');
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/auth/login`, 'POST', false)).toBeNull();
    window.localStorage.clear();
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/guest/session`, 'POST', false)).toBeNull();
  });

  it("Hybrid: the web app's own writes are the page's, not the sync capability", () => {
    signInAs('hybrid');
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/projects`, 'POST', true)).toBeNull();
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/limbic/block`, 'POST', true)).toBeNull();
  });

  it('a third-party origin is not the platform', () => {
    signInAs('local-only');
    expect(webApiRequestRefusal('https://models.example.com/v1/chat/completions', 'POST', true)).toBeNull();
  });
});

describe('Local only refuses content, not page data', () => {
  const CONTENT: ReadonlyArray<readonly [string, string]> = [
    ['/llm/v1/chat/completions', 'POST'],
    ['/api/brain/stream', 'POST'],
    ['/api/brain/chats/3/messages', 'GET'],
    ['/api/chats/3/messages', 'POST'],
    ['/api/brain/upload', 'POST'],
    ['/api/brain/fetch-url', 'POST'],
    ['/api/projects/12/evermind/recall', 'POST'],
    ['/api/limbic/block', 'POST'],
    ['/api/sync/v1/push', 'POST'],
    ['/api/quality-ingest/product-report', 'POST'],
  ];

  it('refuses every content-carrying request, credentialed or anonymous', () => {
    window.localStorage.setItem(WEB_INFERENCE_MODE_STORAGE_KEY, 'local-only');
    for (const [path, method] of CONTENT) {
      expect(webApiRequestRefusal(`${API_ORIGIN}${path}`, method, true), `${method} ${path} (credentialed)`).not.toBeNull();
      expect(webApiRequestRefusal(`${API_ORIGIN}${path}`, method, false), `${method} ${path} (anonymous)`).not.toBeNull();
    }
  });

  it('an anonymous visitor (Local only by default) is refused content too', () => {
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/brain/stream`, 'POST', false)).toBe('gateway-inference');
  });

  it("lets the page's ordinary reads and writes through, signed in", () => {
    signInAs('local-only');
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/projects`, 'GET', true)).toBeNull();
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/projects`, 'POST', true)).toBeNull();
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/tasks/4`, 'PATCH', true)).toBeNull();
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/brain/chats`, 'GET', true)).toBeNull();
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/llm/models`, 'GET', true)).toBeNull();
  });

  it('drops an error report without fetching it', async () => {
    signInAs('local-only');
    await expect(reportBackgroundFailure({ title: 'Boom', message: 'it broke', url: 'https://app.test/x' } as never)).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Hybrid sends the same content', () => {
    signInAs('hybrid');
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/brain/stream`, 'POST', true)).toBeNull();
    expect(webApiRequestRefusal(`${API_ORIGIN}/api/brain/chats/3/messages`, 'GET', true)).toBeNull();
  });
});
