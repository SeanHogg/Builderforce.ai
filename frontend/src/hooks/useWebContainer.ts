'use client';

import { useState, useRef, useCallback } from 'react';
import type { WebContainerState } from '@/lib/types';

let webContainerInstance: import('@webcontainer/api').WebContainer | null = null;
let bootPromise: Promise<import('@webcontainer/api').WebContainer> | null = null;

// Task 1: Build a proper nested FileSystemTree from flat path→content map.
// WebContainers expects: { src: { directory: { 'main.js': { file: { contents } } } } }
// A plain flat map { 'src/main.js': { file: ... } } silently fails to mount subdirs.
function buildFileSystemTree(files: Record<string, string>): Record<string, any> {
  const tree: Record<string, any> = {};
  for (const [rawPath, contents] of Object.entries(files)) {
    const parts = rawPath.split('/').filter(Boolean);
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

    // WebContainer needs a cross-origin isolated context to transfer the
    // SharedArrayBuffer to its worker. Without the COOP/COEP headers (see
    // public/_headers + next.config.js) `crossOriginIsolated` is false; boot
    // then dies mid-build with a cryptic DataCloneError, and the next attempt
    // throws "Unable to create more instances". Fail fast with the real cause.
    if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) {
      const msg =
        'This page is not cross-origin isolated, so WebContainer cannot start. ' +
        'The server must send Cross-Origin-Opener-Policy: same-origin and ' +
        'Cross-Origin-Embedder-Policy: require-corp/credentialless on this route.';
      setState({ status: 'error', error: msg });
      throw new Error(msg);
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

  /**
   * Recursively read a directory out of the booted WebContainer's filesystem,
   * returning every file as `{ path, data }` with paths relative to `root`.
   * Used to capture a `dist/` build output for publishing to subdomain hosting.
   */
  const readDirRecursive = useCallback(async (
    root: string,
  ): Promise<Array<{ path: string; data: Uint8Array }>> => {
    const instance = await getOrBootWebContainer();
    const out: Array<{ path: string; data: Uint8Array }> = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      const entries = await instance.fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const childAbs = `${dir}/${entry.name}`;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(childAbs, childRel);
        } else {
          const data = await instance.fs.readFile(childAbs);
          out.push({ path: childRel, data });
        }
      }
    };
    await walk(root, '');
    return out;
  }, [getOrBootWebContainer]);

  /**
   * Write a single file into the booted container's filesystem (creating parent
   * dirs as needed). Used for live-reload: when the dev server is running, pushing
   * an edited file straight into the FS lets Vite HMR update the preview without a
   * full re-mount + restart. No-op if the container isn't booted yet.
   */
  const writeFileToContainer = useCallback(async (path: string, contents: string): Promise<void> => {
    const instance = webContainerInstance;
    if (!instance) return;
    const slash = path.lastIndexOf('/');
    if (slash > 0) {
      await instance.fs.mkdir(path.slice(0, slash), { recursive: true }).catch(() => { /* exists */ });
    }
    await instance.fs.writeFile(path, contents);
  }, []);

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

  return { state, mountFiles, runCommand, runCommandAndWait, readDirRecursive, writeFileToContainer, startShell, startDevServer, getOrBootWebContainer };
}
