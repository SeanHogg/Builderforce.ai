import { HIGHLIGHTER_OPACITY, HIGHLIGHTER_WIDTH_FACTOR, strokePathD, strokeRect, type CanvasStroke } from '@/lib/canvasDrawing';

/**
 * Every stroke as SVG, in the tool that made it. The ONE stroke renderer: the
 * canvas drawing card (`DrawingBody`) and the document drawing block both draw
 * through it, so a mark looks the same wherever it was made.
 */
/** `minTextSize` is the smallest text stroke, in the SVG's own units; a host that shrinks the drawing passes a larger one so text stays readable. */
export function StrokeShapes({ strokes, minTextSize = 12 }: { strokes: readonly CanvasStroke[]; minTextSize?: number }) {
  return <>
    {strokes.map((stroke, index) => {
      const key = stroke.id ?? `${stroke.tool}-${index}`;
      const common = {
        stroke: stroke.stroke,
        strokeWidth: stroke.tool === 'highlighter' ? stroke.strokeWidth * HIGHLIGHTER_WIDTH_FACTOR : stroke.strokeWidth,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        fill: 'none',
        ...(stroke.tool === 'highlighter' ? { opacity: HIGHLIGHTER_OPACITY } : {}),
      };
      if (stroke.tool === 'text') return <text key={key} x={stroke.points[0]!.x} y={stroke.points[0]!.y} fill={stroke.stroke} fontSize={Math.max(minTextSize, stroke.strokeWidth * 5)}>{stroke.text || ''}</text>;
      if (stroke.tool === 'rect') { const box = strokeRect(stroke); return <rect key={key} x={box.x} y={box.y} width={box.width} height={box.height} {...common} />; }
      if (stroke.tool === 'ellipse') { const box = strokeRect(stroke); return <ellipse key={key} cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} {...common} />; }
      return <path key={key} d={strokePathD(stroke)} {...common} />;
    })}
  </>;
}
