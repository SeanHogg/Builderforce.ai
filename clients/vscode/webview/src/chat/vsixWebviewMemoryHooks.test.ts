/**
 * The interactive VSIX chat runs in the Chromium webview, so it composes the on-device
 * tier in front of the server tier, scoped to the project. The extension-host run is a
 * different path and stays server-only — this test pins the webview side only.
 */
import { describe, expect, it, vi } from 'vitest';

const onDevice = { answer: vi.fn(), cacheAnswer: vi.fn() };
const server = { recall: vi.fn(), answer: vi.fn(), cacheAnswer: vi.fn() };
let capturedLoad: (() => Promise<unknown>) | undefined;

vi.mock('@seanhogg/builderforce-brain-embedded', () => ({
  composeEvermindHooks: (...layers: unknown[]) => ({ layers }),
  loadOnDeviceAnswerStore: vi.fn(async () => null),
  onDeviceMemoryHooks: (load: () => Promise<unknown>) => {
    capturedLoad = load;
    return onDevice;
  },
  projectMemoryHooks: vi.fn(() => server),
}));

import { loadOnDeviceAnswerStore, projectMemoryHooks } from '@seanhogg/builderforce-brain-embedded';
import { vsixWebviewMemoryHooks } from './vsixWebviewMemoryHooks';

describe('vsixWebviewMemoryHooks', () => {
  it('puts the on-device tier first and loads it for this project', async () => {
    const hooks = vsixWebviewMemoryHooks(11, vi.fn() as never, 7);
    const layers = (hooks as unknown as { layers: unknown[] }).layers;
    expect(layers[0]).toBe(onDevice);
    expect(layers[1]).toBe(server);
    expect(vi.mocked(loadOnDeviceAnswerStore)).not.toHaveBeenCalled();
    await capturedLoad?.();
    expect(vi.mocked(loadOnDeviceAnswerStore)).toHaveBeenCalledWith(11);
    expect(vi.mocked(projectMemoryHooks)).toHaveBeenCalledWith(11, expect.anything(), 7, 'vsix');
  });
});
