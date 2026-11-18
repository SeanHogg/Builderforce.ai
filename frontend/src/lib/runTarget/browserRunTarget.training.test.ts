import { describe, expect, it, vi } from 'vitest';
import { blueprint, service } from './blueprintFixtures';
import type { RunContext } from './runTarget';

/** The runtime's training channel, as the booted runtime exposes it (`runtime.pythonTraining`). */
const pythonTraining = vi.hoisted(() => ({ expect: () => () => undefined, canCheckpoint: true, granted: () => true, checkpoint: () => 1 }));

vi.mock('@seanhogg/builderforce-webcontainers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seanhogg/builderforce-webcontainers')>()),
  startPreviewRuntime: async () => ({
    fs: { list: () => [], rm: () => undefined, writeFile: () => undefined, readText: () => undefined },
    writeTree: () => undefined,
    setPreviewScripts: () => undefined,
    onError: () => () => undefined,
    onPreviewConsole: () => () => undefined,
    listProcesses: () => [],
    portPolicy: { register: () => () => undefined },
    killApplication: () => undefined,
    forgetApplication: () => undefined,
    phpPlatform: {},
    pythonTraining,
  }),
}));

const pythonOptions = vi.hoisted(() => [] as Array<{ provides?: readonly string[]; training?: unknown }>);
const specs = vi.hoisted(() => [] as Array<{ services: Array<{ id: string; type: string; runtime: string }> }>);
vi.mock('@seanhogg/builderforce-webcontainers/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seanhogg/builderforce-webcontainers/app')>()),
  createPythonProvider: (_runtime: unknown, options: { provides?: readonly string[]; training?: unknown }) => {
    pythonOptions.push(options);
    return { id: 'python' };
  },
  startApplicationRuntime: (spec: { services: Array<{ id: string; type: string; runtime: string }> }) => {
    specs.push(spec);
    return {
      start: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      listServices: () => [],
      getUrl: () => undefined,
      logs: () => new ReadableStream(),
      restart: vi.fn(async () => undefined),
      onStateChange: () => () => undefined,
      onError: () => () => undefined,
    };
  },
}));

const { startInBrowser } = await import('./browserRunTarget');

const TRAINING_ONLY = blueprint({
  services: [service({ id: 'train', kind: 'training', packageManager: 'pip', installCommand: '', devCommand: 'python train.py', ports: [] })],
});
const context: RunContext = { projectId: '7', loadFiles: async () => ({ files: { 'train.py': 'import torch\n' }, unreadable: [] }) };

describe('startInBrowser — a training service', () => {
  it('registers the python provider with the runtime’s training channel and the torch extension’s packages', async () => {
    const started = await startInBrowser(TRAINING_ONLY, context);
    expect(started.ok).toBe(true);
    expect(pythonOptions.at(-1)?.training).toBe(pythonTraining);
    expect(pythonOptions.at(-1)?.provides).toEqual(['torch', 'peft']);
    expect(specs.at(-1)?.services).toEqual([expect.objectContaining({ id: 'train', type: 'training', runtime: 'python' })]);
    if (started.ok) await started.session.stop();
  });
});
