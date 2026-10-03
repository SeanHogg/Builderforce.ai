'use client';

import { useCallback, useRef } from 'react';

type StartShell = (onOutput: (data: string) => void) => Promise<WritableStreamDefaultWriter<string>>;

/**
 * The IDE terminal's shell, started on the FIRST keystroke rather than when the
 * page opens.
 *
 * Starting a shell boots a WebContainer, a metered StackBlitz session. Booting one
 * on every canvas open spent a session even when the user never touched the
 * terminal, and previews no longer need one (they run on our own runtime). Input
 * typed while the shell starts is buffered and flushed, so nothing is lost.
 *
 * Returns the terminal's `onInput` handler.
 */
export function useLazyShell(startShell: StartShell, onOutput: (data: string) => void): (data: string) => void {
  const writerRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  const startingRef = useRef<Promise<void> | null>(null);
  const pendingRef = useRef<string[]>([]);
  const outputRef = useRef(onOutput);
  outputRef.current = onOutput;

  return useCallback((data: string) => {
    if (writerRef.current) {
      void writerRef.current.write(data);
      return;
    }
    pendingRef.current.push(data);
    startingRef.current ??= startShell((chunk) => outputRef.current(chunk))
      .then((writer) => {
        writerRef.current = writer;
        for (const chunk of pendingRef.current.splice(0)) void writer.write(chunk);
      })
      .catch((error: unknown) => {
        // Shown where the user is typing; the next keystroke tries again (a
        // transient boot failure, or a browser that cannot run WebContainers).
        startingRef.current = null;
        pendingRef.current = [];
        outputRef.current(`\r\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`);
      });
  }, [startShell]);
}
