/**
 * Decoupled API error event bus.
 *
 * The HTTP client calls dispatchApiError() on 4xx/5xx responses.
 * GlobalErrorHandler listens for these events and renders toasts.
 * Neither side imports the other — they communicate via CustomEvent.
 */

export interface ApiErrorEvent {
  timestamp: string;
  method: string;
  url: string;
  status: number;
  code?: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export const API_ERROR_EVENT = 'builderforce:api-error' as const;

export function dispatchApiError(
  event: Omit<ApiErrorEvent, 'timestamp'>,
): void {
  window.dispatchEvent(
    new CustomEvent<ApiErrorEvent>(API_ERROR_EVENT, {
      detail: { ...event, timestamp: new Date().toISOString() },
    }),
  );
}
