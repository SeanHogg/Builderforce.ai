// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { posixCommandIn } from '@builderforce/agent-tools';

/**
 * `posixCommandIn` writes the working directory into a command line for a runtime whose exec API
 * takes only one. The in-browser runtime's shell (`bfsh`) has its OWN `cd`, which takes its first
 * argument literally - so the line is only right if THAT shell accepts it. This runs the command
 * through the real installed process worker (the same script the browser loads into a Worker), not a
 * recording fake: `cd -- "./app"` here fails with "no such file or directory: --".
 */
type WorkerMessage = { type: string; data?: unknown; code?: number };

const WORKER = createRequire(import.meta.url).resolve('@seanhogg/builderforce-webcontainers/node/worker.js');

function asText(data: unknown): string {
  return typeof data === 'string' ? data : data instanceof Uint8Array ? new TextDecoder().decode(data) : '';
}

/** Run `command` under bfsh in a fresh worker realm whose workspace holds /app/a.txt. */
async function runInBfsh(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const listeners: Array<(event: { data: unknown }) => void> = [];
  const messages: WorkerMessage[] = [];
  let finish: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => (finish = resolve));
  const scope: Record<string, unknown> = {
    console, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    atob, btoa, WebAssembly, crypto: globalThis.crypto, performance, navigator: {}, location: { href: 'http://x/' },
    Response, Request, Headers, ReadableStream, WritableStream, TransformStream, AbortController, Blob, structuredClone,
    fetch: async () => { throw new Error('no network in this test'); },
    addEventListener: (type: string, listener: (event: { data: unknown }) => void) => { if (type === 'message') listeners.push(listener); },
    postMessage: (message: WorkerMessage) => {
      messages.push(message);
      if (message.type === 'exit') finish();
    },
  };
  scope.globalThis = scope;
  scope.self = scope;
  vm.createContext(scope);
  vm.runInContext(readFileSync(WORKER, 'utf8'), scope);
  for (const listener of listeners) {
    listener({
      data: {
        type: 'start', pid: 1, command: 'bfsh', args: ['-c', command], cwd: '/', env: {}, ipc: false,
        files: [['/app/a.txt', 'hi']], dirs: ['/app'], ports: [], previewOrigin: 'http://x', previewBase: '/x/', packageCache: false,
      },
    });
  }
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('bfsh did not exit')), 8000))]);
  const text = (type: string) => messages.filter((m) => m.type === type).map((m) => asText(m.data)).join('');
  return { stdout: text('stdout'), stderr: text('stderr'), code: messages.find((m) => m.type === 'exit')?.code ?? -1 };
}

describe('posixCommandIn under the real bfsh', () => {
  it('enters the directory and runs the command there', async () => {
    const line = posixCommandIn('app', 'pwd');
    expect(line).not.toBeNull();
    expect(await runInBfsh(line!)).toMatchObject({ stdout: '/app\n', code: 0 });
  });

  it('stops at a directory that is not there - the rest never runs at the root', async () => {
    const result = await runInBfsh(posixCommandIn('missing', 'echo SHOULD-NOT-RUN')!);
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain('SHOULD-NOT-RUN');
    expect(result.stderr).toContain('no such file or directory');
  });
});
