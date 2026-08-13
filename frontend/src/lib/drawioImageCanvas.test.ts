import { describe, expect, it } from 'vitest';
import { appendImageToDrawioCanvas, createDrawioImageCanvas } from './drawioImageCanvas';

const first = { name: 'architecture & notes.png', dataUrl: 'data:image/png;base64,AAAA', width: 800, height: 500 };

describe('draw.io image canvases', () => {
  it('creates a portable mxfile with the image embedded', () => {
    const xml = createDrawioImageCanvas(first);
    expect(xml).toContain('<mxfile');
    expect(xml).toContain('shape=image');
    expect(xml).toContain('data:image/png;base64,AAAA');
    expect(xml).toContain('architecture &amp; notes.png');
  });

  it('adds another image beside the existing artwork', () => {
    const xml = appendImageToDrawioCanvas(createDrawioImageCanvas(first), { name: 'detail.jpg', dataUrl: 'data:image/jpeg;base64,BBBB' });
    expect(xml).toContain('id="image-2"');
    expect(xml).toContain('x="888"');
    expect(xml).toContain('data:image/jpeg;base64,BBBB');
  });

});
