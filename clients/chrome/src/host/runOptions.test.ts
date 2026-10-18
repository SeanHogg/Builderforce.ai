/**
 * Rovr composes the on-device tier in front of the server tier — and only when project
 * memory can actually stand behind the chat. Unsigned, no project, or memory switched
 * off must still yield server-tier-only (in practice: no hooks at all).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const onDevice = { answer: vi.fn(), cacheAnswer: vi.fn() };
const server = { recall: vi.fn(), answer: vi.fn(), cacheAnswer: vi.fn() };
/** The loader Rovr hands the on-device tier — invoked by the test, not by the mock hooks. */
let capturedLoad: (() => Promise<unknown>) | undefined;

vi.mock('@seanhogg/builderforce-brain-embedded', () => ({
  buildComposerDirectives: () => '',
  // The real composer walks the layers in order and keeps the first tier that answers,
  // so the on-device tier must be the FIRST layer handed to it.
  composeEvermindHooks: (...layers: unknown[]) => ({ layers }),
  effortProfile: () => ({ maxTokens: 1024 }),
  isChatMode: (mode: unknown) => mode === 'chat' || mode === 'work',
  loadOnDeviceAnswerStore: vi.fn(async () => null),
  onDeviceMemoryHooks: (load: () => Promise<unknown>) => {
    capturedLoad = load;
    return onDevice;
  },
  projectMemoryHooks: vi.fn(() => server),
  reasoningForRun: () => undefined,
}));

import { loadOnDeviceAnswerStore, projectMemoryHooks } from '@seanhogg/builderforce-brain-embedded';
import { createRunOptions, type RunOptionsDeps } from './runOptions';

function deps(over: Partial<RunOptionsDeps> = {}): RunOptionsDeps {
  return {
    getChat: async () => ({ mode: 'chat', effort: 'balanced', thinking: false, memoryEnabled: true, serverId: 7 }) as never,
    api: {} as never,
    signedIn: () => true,
    projectId: async () => 11,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createRunOptions — on-device memory tier', () => {
  it('composes the on-device tier IN FRONT of the server tier, scoped to the project', async () => {
    const opts = await createRunOptions(deps())(1);
    const layers = (opts.evermind as unknown as { layers: unknown[] }).layers;
    expect(layers[0]).toBe(onDevice);
    expect(layers[1]).toBe(server);
    expect(layers).toHaveLength(2);
    // The loader is lazy — composing the hooks must not load the model — but when the
    // tier does ask, it asks for THIS project, never a global store.
    expect(vi.mocked(loadOnDeviceAnswerStore)).not.toHaveBeenCalled();
    await capturedLoad?.();
    expect(vi.mocked(loadOnDeviceAnswerStore)).toHaveBeenCalledWith(11);
    expect(vi.mocked(projectMemoryHooks)).toHaveBeenCalledWith(11, expect.anything(), 7, 'rovr');
  });

  it('yields no memory hooks at all when unsigned — the on-device tier must not leak in', async () => {
    const opts = await createRunOptions(deps({ signedIn: () => false }))(1);
    expect(opts.evermind).toBeUndefined();
  });

  it('yields no memory hooks when there is no project', async () => {
    const opts = await createRunOptions(deps({ projectId: async () => null }))(1);
    expect(opts.evermind).toBeUndefined();
  });

  it('yields no memory hooks when the chat has memory switched off', async () => {
    const opts = await createRunOptions(deps({
      getChat: async () => ({ mode: 'chat', memoryEnabled: false }) as never,
    }))(1);
    expect(opts.evermind).toBeUndefined();
  });
});
