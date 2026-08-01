'use client';

/**
 * A card whose whole surface opens something AND which hosts its own action buttons.
 *
 * It deliberately is NOT a `<button>`. Nesting an interactive element inside a button is
 * invalid HTML, and browsers resolve it by swallowing the inner control — a Connect /
 * Disconnect button rendered inside a `<button>` card either never fires or fires the
 * card's handler instead. Rendering the card as a `div` with the button role keeps the
 * whole-card click and its keyboard equivalent while leaving the inner controls real.
 *
 * Inner controls must stop propagation on click and keydown so activating them does not
 * also open the card ({@link ConnectToggleButton} does).
 */
export function ClickableCard({
  onClick,
  ariaLabel,
  style,
  children,
}: {
  onClick: () => void;
  /** Accessible name for the card action — the thing being opened. */
  ariaLabel: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(e) => {
        // Enter/Space are what a real <button> responds to; preventDefault stops Space
        // from scrolling the page behind the card.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={style}
    >
      {children}
    </div>
  );
}
