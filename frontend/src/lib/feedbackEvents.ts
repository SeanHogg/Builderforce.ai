/**
 * Opening the app's feedback form from anywhere.
 *
 * `FeedbackTab` owns the form and mounts once in the app shell. Most routes reach
 * it through its tab on the right edge; a route whose own chrome needs that edge
 * (Studio, where it sat on top of the preview) hides the tab and offers an entry
 * in its own menu instead, which calls {@link openFeedback}.
 */
const OPEN_FEEDBACK_EVENT = 'builderforce:open-feedback';

export function openFeedback(): void {
  window.dispatchEvent(new Event(OPEN_FEEDBACK_EVENT));
}

export function onOpenFeedback(listener: () => void): () => void {
  window.addEventListener(OPEN_FEEDBACK_EVENT, listener);
  return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, listener);
}
