/**
 * jsdom polyfills for component tests. jsdom implements the DOM but not the
 * canvas / image-decode / object-URL browser APIs the studio components use.
 * These stubs are deliberately minimal — enough that a component can call them
 * without throwing; tests assert on data flow, not pixel output.
 */
import { vi } from 'vitest';

if (typeof globalThis.createImageBitmap === 'undefined') {
  // Return a lightweight fake bitmap. `close` is tracked so tests can assert a
  // bitmap was released (the engine closes draft bitmaps in two-pass mode).
  globalThis.createImageBitmap = vi.fn(async () => {
    let closed = false;
    return {
      width: 64,
      height: 64,
      close: () => {
        closed = true;
      },
      get __closed() {
        return closed;
      },
    } as unknown as ImageBitmap;
  });
}

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
}
