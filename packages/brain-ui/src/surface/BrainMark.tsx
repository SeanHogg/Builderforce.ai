import { BRAND_LOGO_SRC } from './brandLogo';

/**
 * THE Brain mark — one glyph, one working animation, every surface (web canvas, Brain
 * panel, Studio, the floating launcher, VS Code, Rovr). Moved here from the web app so
 * the editor and the browser panel wear the same identity instead of their own.
 *
 * The glyph is the BuilderForce logo (`brandLogo.ts`) — the product's own mark, not a
 * generic icon. It owns the PROCESSING signal: a ring breathing out of the mark plus a
 * gentle pulse of the glyph. That is a shape, not words — the live activity row narrates
 * the phase. The ring takes the host's accent (`currentColor`).
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
        <img className="bf-mark__img" src={BRAND_LOGO_SRC} width={24} height={24} alt="" draggable={false} />
      </span>
    </span>
  );
}
