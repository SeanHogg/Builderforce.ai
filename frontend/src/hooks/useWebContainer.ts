'use client';

import { useState, useRef, useCallback } from 'react';
import type { WebContainerState } from '@/lib/types';

let webContainerInstance: import('@webcontainer/api').WebContainer | null = null;
let bootPromise: Promise<import('@webcontainer/api').WebContainer> | null = null;

export function useWebContainer() {
  const [state, setState] = useState<WebContainerState>({ status: 'idle' });
  const instanceRef = useRef<import('@webcontainer/api').WebContainer | null>(null);

  const getOrBootWebContainer = useCallback(async () => {
    if (webContainerInstance) {
      instanceRef.current = webContainerInstance;
      return webContainerInstance;
    }
    if (bootPromise) {
      const instance = await bootPromise;
      instanceRef.current = instance;
      return instance;
    }
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
      throw error;
    }
  }, []);

  const mountFiles = useCallback(async (files: Record<string, string>) => {
    const instance = await getOrBootWebContainer();
    const fileSystemTree: Record<string, { file: { contents: string } }> = {};
    for (const [path, contents] of Object.entries(files)) {
      fileSystemTree[path] = { file: { contents } };
    }
    await instance.mount(fileSystemTree);
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

  const startDevServer = useCallback(async (onOutput?: (data: string) => void): Promise<string> => {
    const instance = await getOrBootWebContainer();
    return new Promise((resolve, reject) => {
      instance.on('server-ready', (port, url) => {
        setState(prev => ({ ...prev, url }));
        resolve(url);
      });
      instance.spawn('npm', ['run', 'dev']).then(process => {
        if (onOutput) {
          process.output.pipeTo(new WritableStream({
            write(data) { onOutput(data); },
          }));
        }
        process.exit.then(code => {
          if (code !== 0) reject(new Error(`Dev server exited with code ${code}`));
        });
      }).catch(reject);
    });
  }, [getOrBootWebContainer]);

  return { state, mountFiles, runCommand, startDevServer, getOrBootWebContainer };
}
