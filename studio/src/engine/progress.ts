/**
 * The one progress sink every studio engine reports through.
 *
 * Single emit point: log to console AND fan out to the consumer callback. No
 * silent phases — if an engine is doing something (downloading weights,
 * creating sessions, denoising a step), this fires.
 */
export function reportProgress(
  label: string,
  onProgress: ((label: string) => void) | undefined,
): void {
  // eslint-disable-next-line no-console
  console.info(`[builderforce-studio] ${label}`);
  onProgress?.(label);
}
