/**
 * Deliver ResizeObserver notifications outside the browser's resize-delivery
 * cycle. DOM writes inside a raw observer callback can resize another observed
 * element and trigger the browser's undelivered-notifications loop error.
 */
export function observeResizeOnAnimationFrame(
  target: Element | Element[],
  callback: ResizeObserverCallback,
): () => void {
  let frameId: number | null = null;
  let latestEntries: ResizeObserverEntry[] = [];
  const observer = new ResizeObserver((entries) => {
    latestEntries = entries;
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      callback(latestEntries, observer);
    });
  });
  for (const element of Array.isArray(target) ? target : [target]) observer.observe(element);
  return () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    observer.disconnect();
  };
}
