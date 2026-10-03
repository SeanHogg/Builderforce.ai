// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useState } from 'react';
import type { PreviewRuntime } from '@seanhogg/builderforce-webcontainers';
import type { RuntimeState } from '@/lib/types';
import { useErrorText } from '@/i18n/useErrorMessage';
import { bootSharedPreviewRuntime, replaceProjectFiles } from '@/lib/browserRuntime/previewRuntime';

/** Pipe a process's output to `onOutput` (if any) without holding the stream open. */
function forward(output: ReadableStream<string>, onOutput?: (data: string) => void): void {
  if (!onOutput) return;
  void output.pipeTo(new WritableStream({ write: (data) => onOutput(data) }));
}

/**
 * The project's Node environment in the browser — our own runtime, the same
 * instance the instant preview runs on: mount files, `npm install`, run the
 * project's dev server, and give the terminal a shell. Every process runs on
 * the isolated preview origin (see `previewRuntime.ts`).
 */
export function useProjectRuntime() {
  const [state, setState] = useState<RuntimeState>({ status: 'idle' });
  const errorText = useErrorText();

  const runtime = useCallback(async (): Promise<PreviewRuntime> => {
    setState((current) => (current.status === 'ready' ? current : { status: 'booting' }));
    try {
      const booted = await bootSharedPreviewRuntime();
      setState((current) => (current.status === 'ready' ? current : { status: 'ready' }));
      return booted;
    } catch (error) {
      setState({ status: 'error', error: errorText(error) });
      throw error;
    }
  }, [errorText]);

  const mountFiles = useCallback(async (files: Record<string, string>) => {
    replaceProjectFiles(await runtime(), files);
  }, [runtime]);

  /** Run a command to completion; resolves with its exit code. */
  const runCommandAndWait = useCallback(async (command: string, args: string[], onOutput?: (data: string) => void): Promise<number> => {
    const process = (await runtime()).spawn(command, args);
    forward(process.output, onOutput);
    return process.exit;
  }, [runtime]);

  /**
   * `npm run dev`, resolving with the URL to preview once the server listens.
   * Rejects with the output when the script exits before it is ready, so the
   * caller can show (and the agent can read) why.
   */
  const startDevServer = useCallback(async (onOutput?: (data: string) => void): Promise<string> => {
    const booted = await runtime();
    return new Promise<string>((resolve, reject) => {
      let output = '';
      let ready = false;
      const stop = booted.on('server-ready', (_port, url) => {
        ready = true;
        stop();
        setState((current) => ({ ...current, url }));
        resolve(url);
      });
      const process = booted.spawn('npm', ['run', 'dev']);
      forward(process.output, (data) => { output += data; onOutput?.(data); });
      void process.exit.then((code) => {
        if (ready) return;
        stop();
        reject(new Error(`Dev server exited with code ${code}. output:\n${output}`));
      });
    });
  }, [runtime]);

  /** Push one edit into the running project. A no-op until the runtime has booted. */
  const writeFile = useCallback(async (path: string, contents: string): Promise<void> => {
    if (state.status !== 'ready') return;
    (await runtime()).fs.writeFile(path, contents);
  }, [runtime, state.status]);

  /** A `jsh` shell for the terminal; resolves with the writer its keystrokes go to. */
  const startShell = useCallback(async (onOutput?: (data: string) => void, size?: { cols: number; rows: number }) => {
    const shell = (await runtime()).spawn('jsh', { terminal: size ?? { cols: 80, rows: 24 } });
    forward(shell.output, onOutput);
    return shell.input.getWriter();
  }, [runtime]);

  return { state, mountFiles, runCommandAndWait, startDevServer, writeFile, startShell };
}
