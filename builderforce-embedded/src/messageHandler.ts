import { isFrameToHostMessage } from './protocol';

/**
 * Pure dispatch for inbound frame→host messages. Extracted from the component so
 * the origin check + routing is unit-testable without mounting an iframe.
 */
export interface FrameMessageHandlers {
  /** Origin the iframe is served from; messages from any other origin are ignored. */
  embedOrigin: string;
  onReady: () => void;
  onResize: (height: number) => void;
  onNavigate: (path: string) => void;
  onError: (message: string) => void;
}

export function handleFrameMessage(event: MessageEvent, h: FrameMessageHandlers): void {
  // Trust boundary: only accept messages from the embed origin.
  if (event.origin !== h.embedOrigin) return;
  const msg = event.data;
  if (!isFrameToHostMessage(msg)) return;

  switch (msg.type) {
    case 'ready':
      h.onReady();
      return;
    case 'resize':
      h.onResize(msg.height);
      return;
    case 'navigate':
      h.onNavigate(msg.path);
      return;
    case 'error':
      h.onError(msg.message);
      return;
  }
}
