/**
 * The ONE guarded localStorage accessor pair for the composer's persisted switches.
 * `localStorage` can throw in a webview (storage partitioned or blocked), so every
 * read/write is wrapped here rather than repeating a try/catch per switch — the memory
 * toggle, effort, thinking and the auto-approve gate all go through these.
 *
 * A blocked store degrades to "not persisted", never to a thrown render.
 */
export function readStored(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function writeStored(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* storage blocked */ }
}
