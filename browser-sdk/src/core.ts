/** Source-agnostic helpers shared by the browser and Node entrypoints. */

import type { CaptureContext, NormalizedErrorEvent, QualityClientOptions, StackFrame } from './types';

/** Parse a V8/Firefox-style stack string into frames (best-effort). */
export function parseStack(stack: string | undefined): StackFrame[] | undefined {
  if (!stack) return undefined;
  const frames: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    // "at fn (file:line:col)"  |  "at file:line:col"  |  "fn@file:line:col"
    const m =
      line.match(/^at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/) ||
      line.match(/^at\s+(.+?):(\d+):(\d+)$/) ||
      line.match(/^(.+?)@(.+?):(\d+):(\d+)$/);
    if (!m) continue;
    if (m.length === 5) {
      frames.push({ function: m[1] || null, file: m[2] || null, line: Number(m[3]), column: Number(m[4]) });
    } else if (m.length === 4) {
      frames.push({ function: null, file: m[1] || null, line: Number(m[2]), column: Number(m[3]) });
    }
  }
  return frames.length ? frames : undefined;
}

/** Build a canonical event from an Error (or any thrown value) + options/context. */
export function toEvent(
  err: unknown,
  opts: QualityClientOptions,
  ctx: CaptureContext = {},
  defaultUrl?: string | null,
): NormalizedErrorEvent {
  const e = err instanceof Error ? err : undefined;
  const message = e?.message ?? (typeof err === 'string' ? err : String(err));
  const type = e?.name ?? (typeof err === 'object' && err && 'name' in err ? String((err as { name: unknown }).name) : 'Error');
  return {
    type: type || 'Error',
    message: message || 'Unknown error',
    stack: parseStack(e?.stack) ?? e?.stack ?? null,
    level: ctx.level ?? 'error',
    timestamp: new Date().toISOString(),
    release: opts.release ?? null,
    environment: opts.environment ?? null,
    url: ctx.url ?? defaultUrl ?? null,
    userKey: ctx.userKey ?? opts.userKey ?? null,
    tags: ctx.tags,
    context: ctx.context,
    source: 'native',
  };
}

/** POST a batch of events to `${endpoint}/events`. Resolves false on failure (never throws). */
export async function postEvents(
  opts: QualityClientOptions,
  events: NormalizedErrorEvent[],
): Promise<boolean> {
  if (events.length === 0) return true;
  const url = `${opts.endpoint.replace(/\/$/, '')}/events`;
  const fetchFn = opts.fetchFn ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!fetchFn) return false;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.key}` },
      body: JSON.stringify(events),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
