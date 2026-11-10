import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AnimationPaintStage } from './AnimationPaintStage';
import type { AnimationState } from '@/lib/creation/animation/animationState';

const store = vi.hoisted(() => ({ resolve: null as ((url: string) => void) | null }));
vi.mock('@/lib/creation/exportArtifact', () => ({
  storeCreationFile: () => new Promise<string>((resolve) => { store.resolve = resolve; }),
}));
/** Set `hold` to make the next decodes wait until `release()` is called. */
const decode = vi.hoisted(() => ({ hold: false, waiting: [] as Array<() => void> }));
vi.mock('@/lib/creation/animation/frameDecode', () => ({
  decodeFrame: (url: string) => (decode.hold
    ? new Promise((resolve) => { decode.waiting.push(() => resolve({ decoded: url })); })
    : Promise.resolve({ decoded: url })),
}));
const raster = vi.hoisted(() => ({ stampDab: vi.fn() }));
vi.mock('@/lib/creation/animation/rasterPaint', () => ({
  stampDab: raster.stampDab, strokeBetween: vi.fn(), floodFillCanvas: vi.fn(() => false), pickColor: vi.fn(() => null),
}));

/** One fake 2D context per canvas element, recording what was drawn on it in order. */
type Op = { op: 'clear' } | { op: 'draw'; source: unknown };
const contexts = new WeakMap<HTMLCanvasElement, { ops: Op[] }>();
function ctxOf(canvas: HTMLCanvasElement) {
  let entry = contexts.get(canvas);
  if (!entry) {
    const ops: Op[] = [];
    entry = { ops };
    contexts.set(canvas, entry);
  }
  return entry;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const { ops } = ctxOf(this);
    return {
      clearRect: () => { ops.push({ op: 'clear' }); },
      fillRect: () => {},
      drawImage: (source: unknown) => { ops.push({ op: 'draw', source }); },
      save: () => {},
      restore: () => {},
      globalAlpha: 1,
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
    cb(new Blob(['png'], { type: 'image/png' }));
  });
  (HTMLCanvasElement.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
});

afterEach(() => {
  vi.restoreAllMocks();
  store.resolve = null;
  decode.hold = false;
  decode.waiting = [];
  raster.stampDab.mockClear();
});

const state = (): AnimationState => ({
  schemaVersion: 1, width: 4, height: 4, fps: 12, background: { kind: 'transparent' }, onionSkinDepth: 0, loopCount: 0,
  frames: [{ id: 'A', pixelsDataUrl: 'a0', hold: 1 }, { id: 'B', pixelsDataUrl: 'b0', hold: 1 }],
});

function stage(activeId: string, s: AnimationState, onCommitPixels = vi.fn()) {
  return <AnimationPaintStage
    state={s}
    activeId={activeId}
    tool="brush"
    brush={{ color: '#000000', size: 2, opacity: 1 } as never}
    paintable
    onCommitPixels={onCommitPixels}
    onPickColor={() => {}}
  />;
}

describe('AnimationPaintStage', () => {
  it('regression: returning to a frame whose upload is still pending repaints THAT frame, not the one just left', async () => {
    const s = state();
    const { rerender } = render(stage('A', s));
    const paint = screen.getByRole('img') as HTMLCanvasElement;
    await act(async () => {});

    // Paint on A, then switch to B before the debounced write: leaving A writes it (upload pending).
    fireEvent.pointerDown(paint, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(paint, { pointerId: 1 });
    rerender(stage('B', s));
    await act(async () => {});
    expect(store.resolve).not.toBeNull();
    const ops = ctxOf(paint).ops;
    expect(ops[ops.length - 1]).toEqual({ op: 'draw', source: { decoded: 'b0' } });

    // Back to A while its upload is still running: A's own (local) pixels, not B's.
    const before = ops.length;
    rerender(stage('A', s));
    await act(async () => {});
    const after = ops.slice(before);
    expect(after[0]).toEqual({ op: 'clear' });
    const drawn = after.filter((o): o is Extract<Op, { op: 'draw' }> => o.op === 'draw');
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.source).toBeInstanceOf(HTMLCanvasElement);
    expect(drawn[0]!.source).not.toBe(paint);
  });

  it('regression: a stroke before the frame decodes is not painted over by the decoded pixels', async () => {
    decode.hold = true;
    render(stage('A', state()));
    const paint = screen.getByRole('img') as HTMLCanvasElement;
    await act(async () => {});
    // Still decoding: the pointer is ignored, so nothing can be drawn under the incoming base.
    fireEvent.pointerDown(paint, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(paint, { pointerId: 1 });
    expect(raster.stampDab).not.toHaveBeenCalled();

    await act(async () => { decode.waiting.forEach((release) => release()); });
    expect(ctxOf(paint).ops.at(-1)).toEqual({ op: 'draw', source: { decoded: 'a0' } });
    fireEvent.pointerDown(paint, { button: 0, pointerId: 2 });
    expect(raster.stampDab).toHaveBeenCalledOnce();
  });

  it('repaints from the strip once the upload has landed', async () => {
    const s = state();
    const onCommit = vi.fn();
    const { rerender } = render(stage('A', s, onCommit));
    const paint = screen.getByRole('img') as HTMLCanvasElement;
    await act(async () => {});
    fireEvent.pointerDown(paint, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(paint, { pointerId: 1 });
    rerender(stage('B', s, onCommit));
    await act(async () => {});
    await act(async () => { store.resolve!('a1'); });
    expect(onCommit).toHaveBeenCalledWith('A', 'a1');

    const next = { ...s, frames: [{ id: 'A', pixelsDataUrl: 'a1', hold: 1 }, s.frames[1]!] };
    const ops = ctxOf(paint).ops;
    const before = ops.length;
    rerender(stage('A', next, onCommit));
    await act(async () => {});
    expect(ops.slice(before)).toEqual([{ op: 'clear' }, { op: 'draw', source: { decoded: 'a1' } }]);
  });
});
