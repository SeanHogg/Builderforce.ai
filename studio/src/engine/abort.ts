/**
 * The one cancellation check every studio engine uses between units of work
 * (a frame, a shot, a denoise step). Throws the standard `AbortError` DOMException
 * so callers can tell a user's cancel apart from a real failure with
 * `err.name === 'AbortError'`.
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Generation aborted', 'AbortError');
}
