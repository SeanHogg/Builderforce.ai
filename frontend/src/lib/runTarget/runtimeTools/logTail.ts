/**
 * Read the tail of a run's log stream for a tool answer — and let go. The stream is
 * history-then-live and never ends while the app runs, so the read stops at whichever
 * comes first: the stream goes quiet (`idleMs`), the overall deadline, or the read cap
 * (a chatty dev server must not keep a tool call reading forever). Each line is capped.
 */
import type { RunLogLine } from '../runTarget';

export interface LogTailLimits {
  /** Quiet this long and the history has been read. */
  idleMs: number;
  /** The whole read, however busy the stream. */
  deadlineMs: number;
  /** Lines read in total (the tail is taken from them). */
  maxRead: number;
  /** Characters kept per line. */
  lineChars: number;
}

export const LOG_TAIL_LIMITS: Readonly<LogTailLimits> = { idleMs: 150, deadlineMs: 2_000, maxRead: 5_000, lineChars: 2_000 };

export async function readLogTail(
  stream: ReadableStream<RunLogLine>,
  lines: number,
  limits: Partial<LogTailLimits> = {},
): Promise<RunLogLine[]> {
  const { idleMs, deadlineMs, maxRead, lineChars } = { ...LOG_TAIL_LIMITS, ...Object.fromEntries(Object.entries(limits).filter(([, v]) => v !== undefined)) };
  const reader = stream.getReader();
  const out: RunLogLine[] = [];
  const deadline = Date.now() + deadlineMs;
  let read = 0;
  try {
    while (read < maxRead) {
      const wait = Math.min(idleMs, deadline - Date.now());
      if (wait <= 0) break;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const quiet = new Promise<'quiet'>((resolve) => { timer = setTimeout(() => resolve('quiet'), wait); });
      const next = await Promise.race([reader.read(), quiet]);
      clearTimeout(timer);
      if (next === 'quiet' || next.done) break;
      read++;
      const line = next.value;
      out.push(line.text.length > lineChars ? { ...line, text: `${line.text.slice(0, lineChars)}…` } : line);
      if (out.length > lines) out.shift();
    }
  } finally {
    await reader.cancel();
  }
  return out;
}
