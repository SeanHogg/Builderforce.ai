/**
 * THE Brain mark — one glyph, one working animation, every surface (web canvas, Brain
 * panel, Studio, the floating launcher, VS Code, Rovr). Moved here from the web app so
 * the editor and the browser panel wear the same identity instead of their own.
 *
 * It owns the PROCESSING signal: a ring breathing out of the mark plus a gentle pulse
 * of the glyph. That is a shape, not words — the live activity row narrates the phase.
 * Colour is inherited (`currentColor`), so each host's accent applies in both themes.
 * Styles: `.bf-mark*` in styles.css (reduced motion holds the ring steady).
 */
export interface BrainMarkProps {
  /** A turn is in flight: the mark breathes and a ring pulses out of it. */
  running?: boolean;
  /** Glyph size — any CSS length. Defaults to `1em` so it inherits its host's type. */
  size?: number | string;
}

export function BrainMark({ running = false, size = '1em' }: BrainMarkProps) {
  return (
    <span
      className="bf-mark"
      style={{ fontSize: typeof size === 'number' ? `${size}px` : size }}
      data-state={running ? 'running' : 'idle'}
      aria-hidden
    >
      {running && (
        <>
          <span className="bf-mark__pulse" />
          <span className="bf-mark__pulse bf-mark__pulse--trail" />
        </>
      )}
      <span className="bf-mark__glyph">
        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5.5A4 4 0 0 0 5.5 9a4 4 0 0 0 2 7.5A4 4 0 0 0 12 19M12 5.5A4 4 0 0 1 18.5 9a4 4 0 0 1-2 7.5A4 4 0 0 1 12 19M12 5.5V19M8 9.5h4M12 14.5h4" />
        </svg>
      </span>
    </span>
  );
}
