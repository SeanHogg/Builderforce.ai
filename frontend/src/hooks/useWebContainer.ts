'use client';

import { useState, useRef, useCallback } from 'react';
import type { WebContainerState } from '@/lib/types';

let webContainerInstance: import('@webcontainer/api').WebContainer | null = null;
let bootPromise: Promise<import('@webcontainer/api').WebContainer> | null = null;

// Task 1: Build a proper nested FileSystemTree from flat path→content map.
// WebContainers expects: { src: { directory: { 'main.js': { file: { contents } } } } }
// A plain flat map { 'src/main.js': { file: ... } } silently fails to mount subdirs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFileSystemTree(files: Record<string, string>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tree: Record<string, any> = {};
  for (const [rawPath, contents] of Object.entries(files)) {
    const parts = rawPath.split('/').filter(Boolean);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: Record<string, any> = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      if (!node[dir]) node[dir] = { directory: {} };
      node = node[dir].directory;
    }
    node[parts[parts.length - 1]] = { file: { contents } };
  }
  return tree;
}

export function useWebContainer() {
  const [state, setState] = useState<WebContainerState>({ status: 'idle' });
  const instanceRef = useRef<import('@webcontainer/api').WebContainer | null>(null);

  const getOrBootWebContainer = useCallback(async () => {
    // If we already have an instance, return it
    if (webContainerInstance) {
      instanceRef.current = webContainerInstance;
      setState({ status: 'ready' });
      return webContainerInstance;
    }
    
    // If boot is in progress, wait for it
    if (bootPromise) {
      try {
        const instance = await bootPromise;
        instanceRef.current = instance;
        setState({ status: 'ready' });
        return instance;
      } catch (error) {
        // If the boot promise failed, we need to try again
        bootPromise = null;
        throw error;
      }
    }
    
    // Start a new boot
    setState({ status: 'booting' });
    try {
      const { WebContainer } = await import('@webcontainer/api');
      bootPromise = WebContainer.boot();
      const instance = await bootPromise;
      webContainerInstance = instance;
      instanceRef.current = instance;
      setState({ status: 'ready' });
      return instance;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to boot WebContainer';
      setState({ status: 'error', error: msg });
      bootPromise = null;
      webContainerInstance = null;
      throw error;
    }
  }, []);

  const mountFiles = useCallback(async (files: Record<string, string>) => {
    const instance = await getOrBootWebContainer();
    const tree = buildFileSystemTree(files);
    await instance.mount(tree);
  }, [getOrBootWebContainer]);

  const runCommand = useCallback(async (
    command: string,
    args: string[],
    onOutput?: (data: string) => void
  ) => {
    const instance = await getOrBootWebContainer();
    const process = await instance.spawn(command, args);
    if (onOutput) {
      process.output.pipeTo(new WritableStream({
        write(data) { onOutput(data); },
      }));
    }
    return process;
  }, [getOrBootWebContainer]);

  /** Run a command and wait for it to exit. Returns exit code. Use for npm install so dev server runs after deps are ready. */
  const runCommandAndWait = useCallback(async (
    command: string,
    args: string[],
    onOutput?: (data: string) => void
  ): Promise<number> => {
    const proc = await runCommand(command, args, onOutput);
    return proc.exit;
  }, [runCommand]);

  const startDevServer = useCallback(async (onOutput?: (data: string) => void): Promise<string> => {
    const instance = await getOrBootWebContainer();
    return new Promise((resolve, reject) => {
      let serverReady = false;
      let accumulatedOutput = '';

      instance.on('server-ready', (port, url) => {
        serverReady = true;
        setState(prev => ({ ...prev, url }));
        resolve(url);
      });
      instance.spawn('npm', ['run', 'dev']).then(process => {
        const writer = new WritableStream({
          write(data) {
            accumulatedOutput += data;
            if (onOutput) onOutput(data);
          },
        });
        process.output.pipeTo(writer);

        process.exit.then(code => {
          if (code !== 0 && !serverReady) {
            let msg = `Dev server exited with code ${code}. output:\n${accumulatedOutput}`;
            if (/command not found|not found:|ENOENT/i.test(accumulatedOutput)) {
              msg += '\n\nHint: Ensure dependencies are installed (npm install completed) and your package.json "dev" script is correct (e.g. "vite" or "npx vite").';
            }
            reject(new Error(msg));
          }
        });
      }).catch(err => {
        setState(prev => (prev.status === 'ready' ? { ...prev, error: err instanceof Error ? err.message : String(err) } : prev));
        reject(err);
      });
    });
  }, [getOrBootWebContainer]);

  // Task 2: startShell now exposed so IDE can call it immediately on mount
  const startShell = useCallback(async (
    onOutput?: (data: string) => void,
    size?: { cols: number; rows: number }
  ): Promise<WritableStreamDefaultWriter<string>> => {
    const instance = await getOrBootWebContainer();
    const shellProcess = await instance.spawn('jsh', {
      terminal: size ?? { cols: 80, rows: 24 },
    });
    if (onOutput) {
      shellProcess.output.pipeTo(new WritableStream({
        write(data) { onOutput(data); },
      }));
    }
    return shellProcess.input.getWriter();
  }, [getOrBootWebContainer]);

  return { state, mountFiles, runCommand, runCommandAndWait, startShell, startDevServer, getOrBootWebContainer };
}
