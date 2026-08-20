/**
 * SVG text helpers shared by the chart primitives.
 *
 * SVG has no text wrapping and no ellipsis: a `<text>` runs off the edge of the
 * viewBox and keeps going. Every chart that draws a LABEL therefore needs the same
 * two functions, and they were being re-written per chart — which is how two
 * diagrams on the same screen end up truncating at different widths with different
 * ellipsis rules. One copy, so the whole system clips alike.
 *
 * Both are deliberately measurement-free (no canvas, no DOM): they run identically
 * during SSR and in a test, and a chart that measured text would render differently
 * on the server than in the browser.
 */

/** Trim, and clip to `n` characters with a trailing ellipsis. */
export function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * Naive greedy word-wrap into at most `maxLines` lines of about `perLine`
 * characters. The last line is ellipsised when text was dropped, so a clipped label
 * always LOOKS clipped — a silently shortened one reads as the whole value.
 */
export function wrapSvgText(text: string, perLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > perLine) {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = truncate(lines[maxLines - 1] + '…', perLine);
  }
  return lines.length ? lines : [text];
}
