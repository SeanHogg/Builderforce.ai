import { describe, expect, it, vi } from 'vitest';
import { drawCanvasVideoCaptions } from './canvasVideoRender';

describe('Canvas video caption compositor', () => {
  it('draws a readable caption backing and constrained text into the exported frame', () => {
    const context = { save: vi.fn(), restore: vi.fn(), measureText: vi.fn(() => ({ width: 420 })), fillRect: vi.fn(), fillText: vi.fn(), fillStyle: '', font: '', textAlign: 'start' as CanvasTextAlign, textBaseline: 'alphabetic' as CanvasTextBaseline };
    drawCanvasVideoCaptions(context, 'A caption for the recruiter', 1280, 720);
    expect(context.fillRect).toHaveBeenCalledOnce();
    expect(context.fillText).toHaveBeenCalledWith('A caption for the recruiter', 640, expect.any(Number), expect.any(Number));
    expect(context.restore).toHaveBeenCalledOnce();
  });

  it('does not paint an empty caption', () => {
    const context = { save: vi.fn(), restore: vi.fn(), measureText: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), fillStyle: '', font: '', textAlign: 'start' as CanvasTextAlign, textBaseline: 'alphabetic' as CanvasTextBaseline };
    drawCanvasVideoCaptions(context, '  ', 1280, 720);
    expect(context.fillText).not.toHaveBeenCalled();
  });
});
