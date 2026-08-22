/**
 * figurePoster — draw an article's own figure as poster art.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 * Every generated card was a TITLE on a gradient. Shared into Slack or
 * LinkedIn, an article about a walkable 3D world and an article about invoice
 * ageing looked identical apart from their words — which is the one job the
 * image had. "It says the title" was the report, and it was accurate.
 *
 * The articles already contain drawings: each one carries `bf-figure` blocks,
 * which are DATA (see `components/blog/BlogFigure.tsx`). So the card does not
 * need new artwork commissioned per post — it needs to draw the picture the
 * post is already making.
 *
 * This module turns the FIRST figure of a post into an SVG fragment sized to a
 * box. It is deliberately a fragment and not a document, so the caller owns the
 * card's ground, its title column and its footer.
 *
 * ── WHY IT IS PLAIN ESM ─────────────────────────────────────────────────────
 * Its caller is a build script run by `prebuild` as plain `node`. Nothing here
 * imports the app, and the figure shapes it reads are the same ones
 * `components/blog/figures/types.ts` declares. The seam between the two is
 * asserted by `src/lib/figurePoster.test.ts`: a kind the PAGE can render must
 * either be drawable here or be listed there with the reason it cannot be, so a
 * new kind cannot silently drop a post's card back to a title.
 *
 * Colours arrive as arguments rather than tokens: a PNG has no stylesheet and
 * no theme, so the card carries its own palette.
 */

/** XML-escape — a label with an ampersand must not break the SVG. */
export const esc = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Truncate to a character budget, because the font is not loaded to measure. */
const clip = (value, max) => {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/[\s.,;:]+$/, '')}…`;
};

/**
 * The first `bf-figure` in a post body, parsed. Null when the post has none —
 * which is most of the legacy corpus, and is why the caller keeps a layout that
 * does not need art.
 */
export function firstFigure(markdown) {
  const match = /```bf-figure\r?\n([\s\S]*?)```/.exec(markdown);
  if (!match) return null;
  try {
    const spec = JSON.parse(match[1]);
    return spec && typeof spec === 'object' && spec.kind ? spec : null;
  } catch {
    return null;
  }
}

/**
 * A per-kind palette slot. The figure's own hue names (`make`, `measure`, …)
 * are CSS tokens in the app; on a card they resolve to three fixed accents
 * derived from the card's own hue, so a drawing stays readable on the dark
 * ground without needing the stylesheet that gave those names meaning.
 */
const shade = (palette, hue) => {
  if (hue === 'bad') return palette.bad;
  if (hue === 'good' || hue === 'measure' || hue === 'build') return palette.good;
  if (hue === 'muted') return palette.muted;
  return palette.accent;
};

const text = (x, y, value, { size = 18, weight = 600, fill, anchor = 'start' }) =>
  `<text x="${x}" y="${y}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;

/** A stack of rows — the shape `flow`, `stack` and `bars` all reduce to. */
function rows(items, box, palette, { numbered = false, track = null } = {}) {
  // Up to eight: a caption that says "the eight proofs" over six drawn rows is
  // the figure contradicting its own sentence.
  const count = Math.min(items.length, 8);
  const gap = 10;
  // Fill the box, then centre what is left: three rows drawn at a fixed 64px
  // leave a third of the card empty under them, which reads as a cropped image
  // rather than as a composition.
  const h = Math.min(92, (box.h - gap * (count - 1)) / count);
  const top = box.y + Math.max(0, (box.h - (h * count + gap * (count - 1))) / 2);
  return items.slice(0, count).map((item, index) => {
    const y = top + index * (h + gap);
    const hue = shade(palette, item.hue);
    const width = track ? Math.max(0.22, Math.min(1, item.value / track)) * box.w : box.w;
    // The type follows the row: eight rows in the same box are half the height
    // of four, and a 20px label in a 34px row touches both edges. The NAME is
    // never trimmed to the bar — a short bar means a cheap proof, not a proof
    // with a shorter name, and "Clickable…" hides the thing being ranked.
    const labelSize = h >= 56 ? 20 : h >= 42 ? 17 : 15;
    return `
    <rect x="${box.x}" y="${y}" width="${width.toFixed(0)}" height="${h.toFixed(0)}" rx="10" fill="${hue}" fill-opacity="0.18" stroke="${hue}" stroke-width="2"/>
    <rect x="${box.x}" y="${y}" width="4" height="${h.toFixed(0)}" rx="2" fill="${hue}"/>
    ${numbered ? text(box.x + 18, y + h / 2 + 5, String(index + 1).padStart(2, '0'), { size: 14, weight: 800, fill: hue }) : ''}
    ${text(box.x + (numbered ? 50 : 18), y + h / 2 + labelSize / 3, clip(item.label, 26), { size: labelSize, weight: 700, fill: palette.ink })}`;
  }).join('');
}

/** Columns of dashes — a `compare` reads as its shape, not its sentences. */
function columns(cols, box, palette) {
  const count = Math.min(cols.length, 3);
  const gap = 18;
  const w = (box.w - gap * (count - 1)) / count;
  // Each column is only as tall as it has content, then the block is centred:
  // a fixed-height column with four dashes at the top is mostly empty box, and
  // an empty box reads as a rendering fault rather than as a comparison.
  const longest = Math.max(...cols.slice(0, count).map((column) => Math.min((column.items ?? []).length, 6)), 1);
  const h = Math.min(box.h, 62 + longest * 30 + 14);
  const top = box.y + (box.h - h) / 2;
  return cols.slice(0, count).map((column, index) => {
    const x = box.x + index * (w + gap);
    const hue = shade(palette, column.hue);
    const items = (column.items ?? []).slice(0, 6);
    return `
    <rect x="${x}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="12" fill="${hue}" fill-opacity="0.10" stroke="${hue}" stroke-width="2"/>
    ${text(x + 16, top + 36, clip(column.title, 20), { size: 19, weight: 800, fill: hue })}
    ${items.map((_, row) => `<rect x="${x + 16}" y="${(top + 62 + row * 30).toFixed(0)}" width="${((w - 32) * (row % 2 ? 0.68 : 0.92)).toFixed(0)}" height="9" rx="4" fill="${palette.muted}" fill-opacity="0.55"/>`).join('')}`;
  }).join('');
}

/** The interface picture — the kind that was already a drawing. */
function screen(spec, box, palette) {
  const bar = spec.frame ? 34 : 0;
  const px = (v) => box.x + (v / 100) * box.w;
  const py = (v) => box.y + bar + (v / 100) * (box.h - bar);
  const ph = (v) => (v / 100) * (box.h - bar);
  return `
    <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="14" fill="${palette.panel}" stroke="${palette.muted}" stroke-opacity="0.5" stroke-width="2"/>
    ${spec.frame ? `<line x1="${box.x}" y1="${box.y + bar}" x2="${box.x + box.w}" y2="${box.y + bar}" stroke="${palette.muted}" stroke-opacity="0.4" stroke-width="2"/>
    <circle cx="${box.x + 22}" cy="${box.y + bar / 2}" r="5" fill="${palette.muted}"/>
    <circle cx="${box.x + 40}" cy="${box.y + bar / 2}" r="5" fill="${palette.muted}"/>
    <circle cx="${box.x + 58}" cy="${box.y + bar / 2}" r="5" fill="${palette.muted}"/>` : ''}
    ${(spec.regions ?? []).slice(0, 7).map((region) => {
      const hue = shade(palette, region.hue);
      const ghost = region.style === 'ghost';
      const h = ph(region.h);
      return `<rect x="${px(region.x).toFixed(0)}" y="${py(region.y).toFixed(0)}" width="${((region.w / 100) * box.w).toFixed(0)}" height="${h.toFixed(0)}" rx="9" fill="${ghost ? 'none' : hue}" fill-opacity="${ghost ? 0 : 0.2}" stroke="${ghost ? palette.muted : hue}" stroke-width="2" ${ghost ? 'stroke-dasharray="8 6"' : ''}/>
      ${h > 30 ? text(px(region.x) + ((region.w / 100) * box.w) / 2, py(region.y) + h / 2 + 5, clip(region.label, Math.max(6, Math.round(region.w / 3.4))), { size: 15, weight: 700, fill: ghost ? palette.muted : palette.ink, anchor: 'middle' }) : ''}`;
    }).join('')}`;
}

/** Frames at real widths, to scale — the measurement IS the picture. */
function devices(spec, box, palette) {
  const list = (spec.devices ?? []).slice(0, 4);
  const total = list.reduce((sum, device) => sum + Math.max(1, device.width), 0) || 1;
  const gap = 20;
  const available = box.w - gap * (list.length - 1);
  let cursor = box.x;
  return list.map((device) => {
    const w = (Math.max(1, device.width) / total) * available;
    const h = Math.min(box.h - 34, w * 0.66);
    const y = box.y + (box.h - 34) - h;
    const hue = shade(palette, device.hue);
    const frame = `
    <rect x="${cursor.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="10" fill="${hue}" fill-opacity="0.14" stroke="${hue}" stroke-width="2"/>
    <rect x="${(cursor + w * 0.1).toFixed(0)}" y="${(y + h * 0.16).toFixed(0)}" width="${(w * 0.8).toFixed(0)}" height="8" rx="4" fill="${hue}" fill-opacity="0.8"/>
    <rect x="${(cursor + w * 0.1).toFixed(0)}" y="${(y + h * 0.42).toFixed(0)}" width="${(w * 0.62).toFixed(0)}" height="6" rx="3" fill="${palette.muted}" fill-opacity="0.6"/>
    <rect x="${(cursor + w * 0.1).toFixed(0)}" y="${(y + h * 0.6).toFixed(0)}" width="${(w * 0.44).toFixed(0)}" height="6" rx="3" fill="${palette.muted}" fill-opacity="0.6"/>
    ${text(cursor + w / 2, box.y + box.h - 6, `${device.label} · ${device.width}px`, { size: 15, weight: 700, fill: hue, anchor: 'middle' })}`;
    cursor += w + gap;
    return frame;
  }).join('');
}

/** Points on two axes — the trade-off, without its grid labels. */
function matrix(spec, box, palette) {
  const max = spec.max ?? 5;
  const px = (v) => box.x + ((v - 1) / (max - 1)) * box.w;
  const py = (v) => box.y + box.h - ((v - 1) / (max - 1)) * box.h;
  const grid = Array.from({ length: max }, (_, i) => i + 1).map((tick) => `
    <line x1="${px(tick).toFixed(0)}" y1="${box.y}" x2="${px(tick).toFixed(0)}" y2="${box.y + box.h}" stroke="${palette.muted}" stroke-opacity="0.22" stroke-width="1"/>
    <line x1="${box.x}" y1="${py(tick).toFixed(0)}" x2="${box.x + box.w}" y2="${py(tick).toFixed(0)}" stroke="${palette.muted}" stroke-opacity="0.22" stroke-width="1"/>`).join('');
  const points = (spec.points ?? []).slice(0, 8).map((point) => {
    const hue = shade(palette, point.hue);
    return `<circle cx="${px(point.x).toFixed(0)}" cy="${py(point.y).toFixed(0)}" r="9" fill="${hue}" fill-opacity="0.3" stroke="${hue}" stroke-width="2"/>`;
  }).join('');
  return `${grid}${points}
    ${text(box.x, box.y + box.h + 26, clip(spec.xLabel, 26), { size: 16, weight: 700, fill: palette.muted })}`;
}

/**
 * Draw a spec into a box. Returns an SVG fragment, or null for a kind with no
 * poster form — `templates` and `launch` are a gallery and a list of links, and
 * a card that draws four empty rectangles for them is worse than one that keeps
 * its title layout.
 */
export function posterArt(spec, box, palette) {
  if (!spec) return null;
  switch (spec.kind) {
    case 'flow':
      return rows(spec.steps ?? [], box, palette, { numbered: true });
    case 'stack':
      return rows(spec.bands ?? [], box, palette);
    case 'bars': {
      const values = (spec.rows ?? []).map((row) => row.value ?? 0);
      return rows(spec.rows ?? [], box, palette, { track: spec.max ?? Math.max(...values, 1) });
    }
    case 'compare':
      return columns(spec.columns ?? [], box, palette);
    case 'screen':
      return screen(spec, box, palette);
    case 'devices':
      return devices(spec, box, palette);
    case 'matrix':
      return matrix(spec, box, palette);
    default:
      return null;
  }
}
