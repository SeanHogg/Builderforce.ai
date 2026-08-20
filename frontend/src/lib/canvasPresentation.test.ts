import { describe, expect, it } from 'vitest';
import {
  presentationSequence, presentationStepAt, presentationViewport, stepPresentation,
  type PresentationNodeInput,
} from './canvasPresentation';

const frame = (id: string, x: number, y: number, extra: Partial<PresentationNodeInput['data']> = {}): PresentationNodeInput => ({
  id, position: { x, y }, width: 600, height: 400,
  data: { kind: 'frame', title: id, ...extra },
});

const card = (id: string, x: number, y: number): PresentationNodeInput => ({
  id, position: { x, y }, width: 300, height: 200, data: { kind: 'note', title: id },
});

describe('presentationSequence', () => {
  it('reads a board top to bottom, then left to right', () => {
    const steps = presentationSequence([frame('c', 900, 900), frame('a', 0, 0), frame('b', 900, 0)]);
    expect(steps.map((step) => step.nodeId)).toEqual(['a', 'b', 'c']);
    expect(steps.map((step) => step.index)).toEqual([1, 2, 3]);
  });

  it('treats two frames roughly side by side as one row', () => {
    // Without the band, a four-pixel difference in y — a drag nobody meant to be
    // significant — decides the order of a presentation.
    const steps = presentationSequence([frame('right', 900, 4), frame('left', 0, 0)]);
    expect(steps.map((step) => step.nodeId)).toEqual(['left', 'right']);
  });

  it('lets an authored order override the layout entirely', () => {
    const steps = presentationSequence([
      frame('first', 900, 900, { presentationOrder: 1 }),
      frame('second', 0, 0, { presentationOrder: 2 }),
    ]);
    expect(steps.map((step) => step.nodeId)).toEqual(['first', 'second']);
  });

  it('opens with the numbered frames, not with whichever sits highest', () => {
    // Somebody who numbered two frames on a board of four meant those two to open.
    const steps = presentationSequence([
      frame('unnumbered-top', 0, 0),
      frame('opener', 0, 2_000, { presentationOrder: 1 }),
      frame('second', 900, 2_000, { presentationOrder: 2 }),
      frame('unnumbered-bottom', 900, 4_000),
    ]);
    expect(steps.map((step) => step.nodeId)).toEqual(['opener', 'second', 'unnumbered-top', 'unnumbered-bottom']);
  });

  it('accepts an order authored as a string, because a model will send one', () => {
    const steps = presentationSequence([frame('b', 0, 0, { presentationOrder: '2' }), frame('a', 0, 900, { presentationOrder: '1' })]);
    expect(steps.map((step) => step.nodeId)).toEqual(['a', 'b']);
  });

  it('is a TOTAL order, so two clients cannot disagree', () => {
    // Two frames at one point sorted by nothing would order differently per browser, and
    // a presentation whose order depends on who is driving is not a shared presentation.
    const forward = presentationSequence([frame('z', 10, 10), frame('a', 10, 10)]);
    const reversed = presentationSequence([frame('a', 10, 10), frame('z', 10, 10)]);
    expect(forward.map((step) => step.nodeId)).toEqual(reversed.map((step) => step.nodeId));
  });

  it('walks frames and nothing else', () => {
    // Every object as a step would be a 180-step sequence on a real board.
    expect(presentationSequence([card('note', 0, 0), frame('f', 100, 100)]).map((step) => step.nodeId)).toEqual(['f']);
  });

  it('skips a hidden frame rather than walking an audience to a blank rectangle', () => {
    const hiddenFlag = { ...frame('hidden', 0, 0), hidden: true };
    const hiddenData = frame('hidden-data', 0, 900, { hidden: true });
    expect(presentationSequence([hiddenFlag, hiddenData, frame('shown', 0, 1_800)]).map((step) => step.nodeId)).toEqual(['shown']);
  });

  it('has no sequence at all on a board with no frames', () => {
    // Present mode then behaves exactly as it did before: the control is invisible
    // where there is nothing to walk.
    expect(presentationSequence([card('a', 0, 0)])).toEqual([]);
  });

  it('carries the rectangle the camera has to frame', () => {
    expect(presentationSequence([frame('a', 40, 60)])[0]!.bounds).toEqual({ x: 40, y: 60, width: 600, height: 400 });
  });

  it('leaves an unnamed frame with an empty title rather than inventing one', () => {
    const steps = presentationSequence([{ ...frame('a', 0, 0), data: { kind: 'frame', title: '   ' } }]);
    expect(steps[0]!.title).toBe('');
  });
});

describe('stepPresentation', () => {
  it('clamps rather than wraps', () => {
    // Pressing forward on the last slide in front of a room and landing back on the
    // title reads as a crash.
    expect(stepPresentation(2, 1, 3)).toBe(2);
    expect(stepPresentation(0, -1, 3)).toBe(0);
  });

  it('moves in both directions in between', () => {
    expect(stepPresentation(0, 1, 3)).toBe(1);
    expect(stepPresentation(2, -1, 3)).toBe(1);
  });

  it('refuses to point at an empty sequence', () => {
    expect(stepPresentation(0, 1, 0)).toBeNull();
  });
});

describe('presentationStepAt', () => {
  const steps = presentationSequence([frame('a', 0, 0), frame('b', 0, 900)]);

  it('lands on the last remaining step when the board got shorter underneath you', () => {
    // A collaborator deleting the frame you are standing on is not an error.
    expect(presentationStepAt(steps, 7)?.nodeId).toBe('b');
    expect(presentationStepAt(steps, -3)?.nodeId).toBe('a');
  });

  it('is null for an empty sequence', () => {
    expect(presentationStepAt([], 0)).toBeNull();
  });
});

describe('presentationViewport', () => {
  it('centres the frame in the screen', () => {
    const screen = { width: 1_000, height: 500 };
    const viewport = presentationViewport({ x: 0, y: 0, width: 1_000, height: 500 }, screen);
    // Flow to screen is `flow * zoom + offset`, so the frame's centre must land on the
    // screen's centre whatever the zoom worked out to.
    expect(500 * viewport.zoom + viewport.x).toBeCloseTo(screen.width / 2, 5);
    expect(250 * viewport.zoom + viewport.y).toBeCloseTo(screen.height / 2, 5);
  });

  it('leaves margin, so the cards inside a frame are not flush to the edge', () => {
    // `fitView` frames the frame ITSELF, which puts everything it contains at the
    // screen edge — the reason this is computed here rather than delegated.
    const viewport = presentationViewport({ x: 0, y: 0, width: 1_000, height: 1_000 }, { width: 1_000, height: 1_000 });
    expect(viewport.zoom).toBeLessThan(1);
  });

  it('refuses to magnify a small frame into a cartoon', () => {
    const viewport = presentationViewport({ x: 0, y: 0, width: 10, height: 10 }, { width: 2_000, height: 2_000 });
    expect(viewport.zoom).toBe(1.6);
  });

  it('survives a degenerate frame and a zero-sized screen', () => {
    const viewport = presentationViewport({ x: 0, y: 0, width: 0, height: 0 }, { width: 0, height: 0 });
    expect(Number.isFinite(viewport.x)).toBe(true);
    expect(Number.isFinite(viewport.y)).toBe(true);
    expect(viewport.zoom).toBeGreaterThan(0);
  });
});
