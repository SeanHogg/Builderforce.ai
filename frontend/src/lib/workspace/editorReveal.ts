/**
 * "Open this file AT this line": a search result, a diagnostic, a stack frame.
 *
 * Opening the file and showing the line happen at different times: the
 * workspace switches files, and only then does the editor mount for it. So the
 * request is parked here by path and taken by whichever editor next shows that
 * path. One pending reveal per path; a newer request replaces an older one.
 */

const pending = new Map<string, number>();
const listeners = new Set<(path: string) => void>();

export function requestEditorReveal(path: string, line: number): void {
  pending.set(path, line);
  for (const listener of listeners) listener(path);
}

/** Take the line waiting for `path`, once. */
export function takeEditorReveal(path: string): number | undefined {
  const line = pending.get(path);
  pending.delete(path);
  return line;
}

/** Hear about reveals requested while an editor is already showing a path. */
export function onEditorRevealRequested(listener: (path: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
