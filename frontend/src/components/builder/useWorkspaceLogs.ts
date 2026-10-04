// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createRunLog, type RunLog } from '@/lib/runLog';

export interface WorkspaceLogs {
  /** The run/check terminal's narration, bound to the mounted terminal. */
  log: RunLog;
  /** The Output tab's narration: what a publish build prints, apart from the shell. */
  publishLog: RunLog;
  /** The terminal narration bound to the mount-time writer ref (used before a run). */
  refLog: RunLog;
  /** Raw writer into the terminal, for the lazy shell's output. */
  writeTerminal: (data: string) => void;
  onTerminalReady: (write: (data: string) => void) => void;
  onOutputReady: (write: (data: string) => void) => void;
}

/**
 * The workspace's two terminals and the narration bound to them.
 *
 * Every line the run pipeline authors goes through a `RunLog` so it is (a)
 * translated and (b) formatted by one colour/glyph vocabulary. `npm`/`vite`/`tsc`
 * output is teed through `log.raw` untouched — the tool's own words stay
 * verbatim so they remain searchable.
 */
export function useWorkspaceLogs(): WorkspaceLogs {
  const t = useTranslations('ide');
  const [terminalWriter, setTerminalWriter] = useState<((data: string) => void) | undefined>();
  const terminalWriteRef = useRef<((data: string) => void) | null>(null);
  const outputWriteRef = useRef<((data: string) => void) | null>(null);

  const translate = useCallback(
    (key: string, values?: Record<string, string | number>) => t(`runLog.${key}` as never, values as never),
    [t],
  );

  const log = useMemo(() => createRunLog(terminalWriter, translate), [terminalWriter, translate]);
  const publishLog = useMemo(() => createRunLog((data) => outputWriteRef.current?.(data), translate), [translate]);
  const refLog = useMemo(() => createRunLog((data) => terminalWriteRef.current?.(data), translate), [translate]);

  const onTerminalReady = useCallback((write: (data: string) => void) => {
    terminalWriteRef.current = write;
    setTerminalWriter(() => write);
  }, []);
  const onOutputReady = useCallback((write: (data: string) => void) => {
    outputWriteRef.current = write;
  }, []);
  const writeTerminal = useCallback((data: string) => terminalWriteRef.current?.(data), []);

  return { log, publishLog, refLog, writeTerminal, onTerminalReady, onOutputReady };
}
