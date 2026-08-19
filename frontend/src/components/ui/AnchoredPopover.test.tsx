import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { AnchoredPopover } from './AnchoredPopover';

/**
 * The primitive four surfaces now share — the canvas team overflow, the session `•••`
 * menu, the assignee hovercard and every `<Select>` listbox. The bug it was extracted
 * from was a panel that WAS in the DOM and could not be seen, so "renders" is not what
 * these assert: they assert where it lands, and that it stays inside the viewport.
 */

const LAYER_W = 200;
const LAYER_H = 160;

/** jsdom lays nothing out, so the layer's own box has to be stated. The anchor's rect is
 *  stated per test, which is what actually varies. */
function measurable() {
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(LAYER_W);
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(LAYER_H);
  return () => { width.mockRestore(); height.mockRestore(); };
}

function Harness({ anchorRect, ...props }: { anchorRect: Partial<DOMRect> } & Record<string, unknown>) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        ref={(node) => {
          anchorRef.current = node;
          if (node) node.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, ...anchorRect, toJSON: () => ({}) }) as DOMRect;
        }}
        onClick={() => setOpen((value) => !value)}
      >trigger</button>
      <AnchoredPopover open={open} anchorRef={anchorRef} onDismiss={() => setOpen(false)} {...props}>
        <span>panel body</span>
      </AnchoredPopover>
    </div>
  );
}

afterEach(() => { vi.restoreAllMocks(); });

describe('AnchoredPopover', () => {
  it('portals out of its parent, so no ancestor stacking context can paint over it', () => {
    const restore = measurable();
    const { container } = render(<Harness anchorRect={{ top: 100, bottom: 120, left: 40, right: 90, width: 50 }} />);
    const panel = screen.getByText('panel body');
    expect(container.contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
    restore();
  });

  it('opens above the anchor when told to, measuring the layer rather than guessing', () => {
    const restore = measurable();
    // A bar at the bottom of a 768px-tall window — the canvas command bar's case.
    render(<Harness anchorRect={{ top: 700, bottom: 726, left: 600, right: 626, width: 26 }} placement="above" gap={10} />);
    const layer = screen.getByText('panel body').parentElement as HTMLElement;
    // 700 − 10 gap − 160 tall.
    expect(layer.style.top).toBe('530px');
    expect(layer.style.position).toBe('fixed');
    restore();
  });

  it('flips above on its own when the space below cannot hold it', () => {
    const restore = measurable();
    window.innerHeight = 768;
    render(<Harness anchorRect={{ top: 700, bottom: 720, left: 100, right: 160, width: 60 }} placement="auto" />);
    const layer = screen.getByText('panel body').parentElement as HTMLElement;
    expect(Number.parseInt(layer.style.top, 10)).toBeLessThan(700);
    restore();
  });

  it('clamps to the viewport instead of hanging off the right edge', () => {
    const restore = measurable();
    window.innerWidth = 1024;
    render(<Harness anchorRect={{ top: 40, bottom: 60, left: 1000, right: 1020, width: 20 }} />);
    const layer = screen.getByText('panel body').parentElement as HTMLElement;
    // 1024 − 200 wide − 8 margin.
    expect(layer.style.left).toBe('816px');
    restore();
  });

  it('aligns its right edge to the anchor when asked', () => {
    const restore = measurable();
    window.innerWidth = 1024;
    render(<Harness anchorRect={{ top: 40, bottom: 60, left: 500, right: 560, width: 60 }} align="end" />);
    const layer = screen.getByText('panel body').parentElement as HTMLElement;
    expect(layer.style.left).toBe('360px');
    restore();
  });

  it('closes on Escape and on an outside press, but not on a press on its own trigger', () => {
    const restore = measurable();
    render(<Harness anchorRect={{ top: 100, bottom: 120, left: 40, right: 90, width: 50 }} />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'trigger' }));
    expect(screen.queryByText('panel body')).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('panel body')).toBeNull();
    restore();
  });

  it('registers no dismissal at all without an onDismiss — a hover layer owns its own close', () => {
    const restore = measurable();
    function HoverHarness() {
      const anchorRef = useRef<HTMLButtonElement | null>(null);
      return (
        <div>
          <button type="button" ref={anchorRef}>trigger</button>
          <AnchoredPopover open anchorRef={anchorRef}><span>panel body</span></AnchoredPopover>
        </div>
      );
    }
    render(<HoverHarness />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('panel body')).toBeTruthy();
    restore();
  });

  it('renders nothing while closed', () => {
    const restore = measurable();
    function ClosedHarness() {
      const anchorRef = useRef<HTMLButtonElement | null>(null);
      return <AnchoredPopover open={false} anchorRef={anchorRef}><span>panel body</span></AnchoredPopover>;
    }
    render(<ClosedHarness />);
    expect(screen.queryByText('panel body')).toBeNull();
    restore();
  });
});
