/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPLAY_PLAYER_GLOBAL } from '@builderforce/interaction-contract';
import { invalidateClientCache } from '@/infrastructure/http/readThrough';
import { appendOnce, loadReplayerBundle } from './replayPlayerLoader';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('@/lib/apiClient', () => ({ apiRequest }));

const PLAYER = { url: 'https://cdn.builderforce.ai/replay/player.abc.js', cssUrl: 'https://cdn.builderforce.ai/replay/player.abc.css', rrweb: '2.0.0' };

class FakeReplayer {}

/** jsdom never loads a script/link: fire `load` once appended, registering the bundle for the script. */
function autoLoadAppends(): void {
  const original = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    const appended = original(node);
    if (node instanceof HTMLScriptElement) {
      (window as unknown as Record<string, unknown>)[REPLAY_PLAYER_GLOBAL] = { Replayer: FakeReplayer };
    }
    queueMicrotask(() => node.dispatchEvent(new Event('load')));
    return appended;
  });
}

describe('replayPlayerLoader', () => {
  beforeEach(() => {
    invalidateClientCache('replay:player');
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>)[REPLAY_PLAYER_GLOBAL];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    apiRequest.mockReset();
  });

  it('reads the CDN manifest without credentials and appends the bundle script and stylesheet once', async () => {
    apiRequest.mockResolvedValue({ latest: { version: '1', url: 'x', hash: 'h', builtAt: 'now' }, player: PLAYER });
    autoLoadAppends();

    const Replayer = await loadReplayerBundle<unknown>();

    expect(Replayer).toBe(FakeReplayer);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest.mock.calls[0]?.[0]).toBe('/replay/manifest.json');
    expect(apiRequest.mock.calls[0]?.[1]).toMatchObject({ baseUrl: 'https://cdn.builderforce.ai', auth: 'none', credentials: 'omit' });
    expect(document.head.querySelectorAll(`script[src="${PLAYER.url}"]`)).toHaveLength(1);
    expect(document.head.querySelectorAll(`link[href="${PLAYER.cssUrl}"]`)).toHaveLength(1);

    // A second load reuses the bundle: no second fetch, no second element.
    await loadReplayerBundle<unknown>();
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    expect(document.head.querySelectorAll('link')).toHaveLength(1);
  });

  it('appendOnce does not append a URL that is already in the head', async () => {
    autoLoadAppends();
    await appendOnce('script', PLAYER.url);
    await appendOnce('script', PLAYER.url);
    await appendOnce('link', PLAYER.cssUrl);
    await appendOnce('link', PLAYER.cssUrl);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    expect(document.head.querySelectorAll('link')).toHaveLength(1);
    expect(document.head.querySelector('link')?.getAttribute('rel')).toBe('stylesheet');
  });

  it('rejects when the manifest names no player', async () => {
    apiRequest.mockResolvedValue({ latest: { version: '1', url: 'x', hash: 'h', builtAt: 'now' } });
    await expect(loadReplayerBundle<unknown>()).rejects.toThrow('replay manifest has no player');
    expect(document.head.querySelector('script')).toBeNull();
  });

  it('rejects when the manifest request fails', async () => {
    apiRequest.mockRejectedValue(new Error('Request failed: 503'));
    await expect(loadReplayerBundle<unknown>()).rejects.toThrow('503');
  });
});
