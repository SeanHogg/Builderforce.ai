// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createRunLog, type RunLog } from '@/lib/runLog';

type Writer = (data: string) => void;

export interface WorkspaceLogs {
  /** The run/check terminal's narration, bound to the mounted terminal. */
  log: RunLog;
  /** The Output tab's narration: what a publish build prints, apart from the shell. */
  publishLog: RunLog;
  /** Raw writer into the terminal, for the lazy shell's output. */
  writeTerminal: Writer;
  onTerminalReady: (write: Writer) => void;
  onOutputReady: (write: Writer) => void;
}

/**
 * The workspace's two terminals and the narration bound to them.
 *
 * Every line the run pipeline authors goes through a `RunLog` so it is (a)
 * translated and (b) formatted by one colour/glyph vocabulary. `npm`/`vite`/`tsc`
 * output is teed through `log.raw` untouched — the tool's own words stay
 * verbatim so they remain searchable. The writers are state, not refs, so a log
 * rebinds when its terminal mounts and nothing reads a ref during render.
 */
export function useWorkspaceLogs(): WorkspaceLogs {
  const t = useTranslations('ide');
  const [terminalWriter, setTerminalWriter] = useState<Writer | undefined>();
  const [outputWriter, setOutputWriter] = useState<Writer | undefined>();

  const translate = useCallback(
    (key: string, values?: Record<string, string | number>) => t(`runLog.${key}` as never, values as never),
    [t],
  );

  const log = useMemo(() => createRunLog(terminalWriter, translate), [terminalWriter, translate]);
  const publishLog = useMemo(() => createRunLog(outputWriter, translate), [outputWriter, translate]);

  const onTerminalReady = useCallback((write: Writer) => setTerminalWriter(() => write), []);
  const onOutputReady = useCallback((write: Writer) => setOutputWriter(() => write), []);
  const writeTerminal = useCallback((data: string) => terminalWriter?.(data), [terminalWriter]);

  return { log, publishLog, writeTerminal, onTerminalReady, onOutputReady };
}
