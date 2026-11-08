/**
 * Raster painting for an animation frame: a round brush, an eraser, a flood fill and
 * an eyedropper. Pixel logic is separated from the canvas so the fill is testable
 * without one.
 */

export type PaintTool = 'brush' | 'eraser' | 'fill' | 'eyedropper';

export interface BrushSettings {
  color: string;
  /** Diameter in canvas pixels. */
  size: number;
}

export interface PaintPoint {
  x: number;
  y: number;
}

/** "#rgb" / "#rrggbb" to [r, g, b, 255]; null when it is neither. */
export function parseHexColor(value: string): [number, number, number, number] | null {
  const hex = value.trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), 255];
}

export function toHexColor(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Scanline flood fill over RGBA bytes, in place. Replaces the connected region of the
 * exact colour under (x, y) with `fill`. Returns whether anything changed.
 */
export function floodFillPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  fill: readonly [number, number, number, number],
): boolean {
  const startX = Math.floor(x);
  const startY = Math.floor(y);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return false;
  const at = (px: number, py: number): number => (py * width + px) * 4;
  const origin = at(startX, startY);
  const target = [data[origin]!, data[origin + 1]!, data[origin + 2]!, data[origin + 3]!] as const;
  if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2] && target[3] === fill[3]) return false;
  const matches = (i: number): boolean => data[i] === target[0] && data[i + 1] === target[1] && data[i + 2] === target[2] && data[i + 3] === target[3];

  const stack: number[] = [startX, startY];
  while (stack.length) {
    const py = stack.pop()!;
    let px = stack.pop()!;
    while (px >= 0 && matches(at(px, py))) px--;
    px++;
    let above = false;
    let below = false;
    while (px < width && matches(at(px, py))) {
      const i = at(px, py);
      data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3];
      if (py > 0) {
        const open = matches(at(px, py - 1));
        if (open && !above) { stack.push(px, py - 1); above = true; } else if (!open) above = false;
      }
      if (py < height - 1) {
        const open = matches(at(px, py + 1));
        if (open && !below) { stack.push(px, py + 1); below = true; } else if (!open) below = false;
      }
      px++;
    }
  }
  return true;
}

/** One round dab; the eraser clears to transparent instead of painting. */
export function stampDab(ctx: CanvasRenderingContext2D, brush: BrushSettings, point: PaintPoint, erase: boolean): void {
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.fillStyle = brush.color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(0.5, brush.size / 2), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A round-capped line between two points, so fast pointer moves leave no gaps. */
export function strokeBetween(ctx: CanvasRenderingContext2D, brush: BrushSettings, from: PaintPoint, to: PaintPoint, erase: boolean): void {
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = brush.color;
  ctx.lineWidth = Math.max(1, brush.size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

/** Fill the region under a point on a live canvas. Returns whether it changed. */
export function floodFillCanvas(ctx: CanvasRenderingContext2D, width: number, height: number, point: PaintPoint, color: string): boolean {
  const rgba = parseHexColor(color);
  if (!rgba) return false;
  const image = ctx.getImageData(0, 0, width, height);
  const changed = floodFillPixels(image.data, width, height, point.x, point.y, rgba);
  if (changed) ctx.putImageData(image, 0, 0);
  return changed;
}

/** The colour under a point as "#rrggbb"; null if it is fully transparent. */
export function pickColor(ctx: CanvasRenderingContext2D, point: PaintPoint): string | null {
  const [r, g, b, a] = ctx.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data;
  return a ? toHexColor(r!, g!, b!) : null;
}
