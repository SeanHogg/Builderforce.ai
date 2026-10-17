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
    /** Localized label of the "try drawing it again" action. */
    retryLabel: string;
    /** Changes when the board behind the boundary changes (another session) — a new
     *  board gets a fresh attempt instead of inheriting the last one's failure. */
    resetKey?: string | number;
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

  // The boundary used to stay failed for the life of the panel: one transient error
  // (a gateway blip while the board loaded) left the board gone until the panel was
  // closed and reopened. It now resets for a different board, and offers a retry.
  componentDidUpdate(prev: Readonly<{ resetKey?: string | number }>): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  private readonly retry = (): void => this.setState({ failed: false });

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="bf-degraded-shell">
        <div className="bf-canvas-degraded" role="status">
          {this.props.notice}{' '}
          <button type="button" className="bf-canvas-degraded__retry" onClick={this.retry}>{this.props.retryLabel}</button>
        </div>
        {this.props.fallback}
      </div>
    );
  }
}
