import { Component, type ErrorInfo, type ReactNode } from 'react';
import { post } from './vscodeBridge';

/**
 * THE CHAT IS THE FLOOR.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Chat is a surface OF the canvas, which is the right model — but it made the
 * conversation depend on the board, and the board depends on things the
 * conversation does not: a resolved creation session, a reachable gateway, a graph
 * that parses, and roughly ~7 MB of board code. Any one of those failing took the
 * whole panel with it, because a React tree that throws unmounts everything above
 * the nearest boundary — and there was no boundary.
 *
 * That is backwards. The conversation is the zero-object case: it needs a transport
 * and a transcript, both of which live in the extension host and neither of which
 * the board is involved in. So a board failure degrades to the thing that still
 * works rather than to an empty panel, and the reader is TOLD, because a canvas that
 * silently renders nothing is indistinguishable from one that is merely empty.
 *
 * ── WHY A CLASS ──────────────────────────────────────────────────────────────
 * `componentDidCatch` has no hook equivalent; an error boundary is the one thing
 * React still requires a class for.
 */
export class CanvasBoundary extends Component<
  {
    children: ReactNode;
    /** What to show instead when the board cannot be drawn — the chat surface. */
    fallback: ReactNode;
    /** Localized one-liner explaining the degrade. */
    notice: string;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The HOST reports it: a webview's console is not somewhere anyone looks, and a
    // board that failed to draw is exactly the class of bug that gets described as
    // "it just doesn't load" with nothing to go on.
    post('canvas.error', {
      message: error.message,
      stack: error.stack?.slice(0, 4_000),
      componentStack: info.componentStack?.slice(0, 4_000),
    });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <>
        <div className="bf-canvas-degraded" role="status">{this.props.notice}</div>
        {this.props.fallback}
      </>
    );
  }
}
