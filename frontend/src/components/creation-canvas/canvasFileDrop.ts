

/** Horizontal gap between objects created by one multi-file drop, so a folder
 * dropped at once lands as a readable row rather than a single stack. */
export const IMPORT_COLUMN_GAP = 360;

/** Vertical gap for the EXTRA objects one file yields — a workbook's second and
 * third sheets stack under the card that stood in for the file. */
export const IMPORT_ROW_GAP = 300;

/**
 * Let the browser paint before the next parse takes the main thread back.
 *
 * `officeFormats`' readers are synchronous CPU inside an async signature, so
 * committing a node to React state and immediately starting the next read means
 * the commit never reaches the screen. One frame, then a macrotask, is the pair
 * that reliably gets a paint out of both engines.
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'undefined') { setTimeout(resolve, 0); return; }
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/** Files read from a single drop. Past this the board stops being legible and
 * the parse cost stops being worth it, so the rest are reported, not silently
 * discarded. */
export const MAX_DROPPED_FILES = 12;

/** Whether a drag carries files from outside the browser, as opposed to an
 * object being dragged off the palette. */
export function dragCarriesFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
