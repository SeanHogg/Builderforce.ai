import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

/**
 * Locks the two-pass preview regression: in the "Refined" tier the engine fires
 * onFrame for BOTH the draft pass and the refinement pass (2N callbacks) and
 * then CLOSES the N draft bitmaps. StudioPanel must hand VideoPreview exactly
 * the engine's final `frames` (N live bitmaps), not the 2N accumulated set that
 * contains closed draft bitmaps — otherwise the thumbnail strip drawImage()s a
 * closed bitmap and throws. We assert the frames VideoPreview receives after a
 * generation equal the engine's returned frames.
 *
 * This is the test layer that was missing when the bug shipped — see the
 * Consolidated Gap Register. We mock the heavy collaborators (engine, hardware
 * probe, preview) so the test exercises StudioPanel's data flow, not WebGPU.
 */

// Shared state for the module mocks. `vi.hoisted` runs before the hoisted
// vi.mock factories, so they can safely close over this.
const h = vi.hoisted(() => {
  const makeBitmap = (tag: string) => {
    let closed = false;
    return {
      tag,
      width: 64,
      height: 64,
      close: () => {
        closed = true;
      },
      get closed() {
        return closed;
      },
    };
  };
  const store = {
    previewFrameProps: [] as unknown[][],
    refinedFrames: [] as ReturnType<typeof makeBitmap>[],
  };
  const VideoEngineMock = {
    create: vi.fn(async () => ({
      generate: vi.fn(async (args: { onFrame?: (i: number, b: unknown) => void }) => {
        const draft = [makeBitmap('draft-0'), makeBitmap('draft-1')];
        store.refinedFrames = [makeBitmap('refined-0'), makeBitmap('refined-1')];
        // Draft pass callbacks, then refinement pass callbacks (2N total).
        draft.forEach((b, i) => args.onFrame?.(i, b));
        store.refinedFrames.forEach((b, i) => args.onFrame?.(i, b));
        // The real engine closes the draft bitmaps after refining.
        draft.forEach((b) => b.close());
        return {
          blob: new Blob(['x']),
          mambaState: { data: [], dim: 1, order: 1, channels: 1, step: 0 },
          frames: store.refinedFrames,
          activeDevice: 'webgpu',
          resolvedPrompt: 'expanded',
          elapsedMs: 1,
        };
      }),
      dispose: vi.fn(async () => {}),
    })),
  };
  return { makeBitmap, store, VideoEngineMock };
});

vi.mock('./VideoPreview', () => ({
  VideoPreview: (props: { frames: unknown[] }) => {
    h.store.previewFrameProps.push(props.frames);
    return null;
  },
}));

vi.mock('./useEngineStatus', () => ({
  useEngineStatus: () => ({
    state: 'ready',
    device: { kind: 'webgpu', label: 'Mock GPU', approxMemoryMb: 8192 },
  }),
}));

vi.mock('@seanhogg/builderforce-studio', () => ({
  VideoEngine: h.VideoEngineMock,
  planScene: vi.fn(),
  // ModelPicker reads Object.keys(MODEL_REGISTRY); the values are irrelevant
  // here (the picker lives in the collapsed Advanced section).
  MODEL_REGISTRY: {
    'lcm-tiny-sd': { id: 'lcm-tiny-sd' },
    'sd-turbo': { id: 'sd-turbo' },
    'lcm-dreamshaper-v7': { id: 'lcm-dreamshaper-v7' },
  },
}));

// Import AFTER mocks are registered.
import { StudioPanel } from './StudioPanel';

describe('StudioPanel two-pass preview invariant', () => {
  beforeEach(() => {
    h.store.previewFrameProps.length = 0;
    h.store.refinedFrames = [];
  });

  it('hands VideoPreview exactly the engine final frames (not the 2N accumulated set)', async () => {
    render(<StudioPanel authToken="tok" />);

    fireEvent.change(screen.getByPlaceholderText(/a fox running/i), {
      target: { value: 'a knight' },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => expect(h.VideoEngineMock.create).toHaveBeenCalled());
    await waitFor(() => {
      const last = h.store.previewFrameProps[h.store.previewFrameProps.length - 1];
      expect(last).toEqual(h.store.refinedFrames);
    });

    const finalFrames = h.store.previewFrameProps[
      h.store.previewFrameProps.length - 1
    ] as { closed: boolean }[];
    expect(finalFrames).toHaveLength(2);
    // None of the frames handed to the preview are closed bitmaps.
    expect(finalFrames.every((f) => f.closed === false)).toBe(true);
  });
});
