/**
 * A poster for a generated game.
 *
 * Every creative object on the canvas shows a preview tile, and a game had none:
 * `creativePreviewImageUrl` only trusts a real picture, and a game's export is an
 * HTML document, so a game object fell through to the generic placeholder — the
 * same broken-tile problem CAD and 3D solved by drawing their geometry back.
 *
 * A game cannot be drawn back the way a mesh can. It is a program, and the frame
 * that runs it is deliberately origin-isolated (see `GameBody`), so its pixels
 * are unreadable from here by design — a real screenshot is not available at any
 * price. What IS available is everything the document declares about itself, so
 * the poster is an honest title card built from that: the name, the brief, and
 * the controls the game actually listens for, read out of its own source.
 *
 * That last part is the reason this is worth more than a coloured rectangle. A
 * tile that says "arrows · space · touch" tells you at a glance whether the game
 * the model just wrote will work on a phone, which is the question being asked
 * about it. It is derived, not claimed: if the document does not bind the input,
 * the badge does not appear.
 */

const MAX_TITLE = 26;
const MAX_BRIEF = 96;

function escapeXml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!,
  );
}

function clamp(value: string, length: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/**
 * The same derivation the API uses, so a game's poster, its app icon and its
 * theme colour are one colour rather than three.
 */
export function gameAccent(title: string): string {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const chroma = (1 - Math.abs(2 * 0.52 - 1)) * 0.68;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = 0.52 - chroma / 2;
  const rgb = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ][Math.floor(hue / 60) % 6]!;
  const channel = (v: number) =>
    Math.round((v + match) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(rgb[0]!)}${channel(rgb[1]!)}${channel(rgb[2]!)}`;
}

export interface GameControls {
  keyboard: boolean;
  touch: boolean;
  pointer: boolean;
}

/**
 * What the document actually binds.
 *
 * Read from the source rather than assumed, because "does this play on a phone"
 * is exactly the thing a generated game gets wrong, and a badge that always said
 * "touch" would be decoration rather than information.
 */
export function readGameControls(html: string): GameControls {
  return {
    keyboard: /\b(?:keydown|keyup|keypress)\b/i.test(html),
    touch: /\b(?:touchstart|touchmove|touchend)\b/i.test(html),
    pointer: /\b(?:pointerdown|pointermove|pointerup|['"]click['"])\b/i.test(html),
  };
}

/** The control summary as short labels, in the order they matter on a tile. */
export function controlLabels(controls: GameControls): string[] {
  const labels: string[] = [];
  if (controls.keyboard) labels.push('keys');
  if (controls.touch || controls.pointer) labels.push('touch');
  return labels;
}

/**
 * A poster for a game, as an SVG string.
 *
 * Deliberately opaque and self-contained: it is used as an `<img src>` on the
 * canvas and as a share image, neither of which inherits the app's stylesheet,
 * so it carries its own background rather than assuming one. It reads in both
 * themes because it is dark with its own light-on-dark contrast, not because it
 * adapts — an image cannot respond to a theme, and one that half-tried would be
 * unreadable in whichever theme it lost.
 */
export function gamePosterSvg(input: { title: string; brief?: string; html?: string }): string {
  const title = clamp(input.title || 'Game', MAX_TITLE);
  const brief = clamp(input.brief ?? '', MAX_BRIEF);
  const accent = gameAccent(input.title || 'Game');
  const labels = input.html ? controlLabels(readGameControls(input.html)) : [];

  // A scanline field, sized off the accent — enough texture that a wall of game
  // tiles is distinguishable at a glance without the tile competing with the
  // title for attention.
  const badges = labels
    .map(
      (label, index) =>
        `<g transform="translate(${70 + index * 132} 470)">`
        + `<rect width="118" height="46" rx="23" fill="#ffffff" opacity=".14"/>`
        + `<text x="59" y="30" fill="#ffffff" font-family="system-ui,sans-serif" font-size="21" `
        + `font-weight="650" text-anchor="middle" opacity=".92">${escapeXml(label)}</text></g>`,
    )
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">`
    + '<defs>'
    + `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="#0b0e1a"/><stop offset="1" stop-color="${escapeXml(accent)}"/>`
    + '</linearGradient>'
    + '<pattern id="scan" width="6" height="6" patternUnits="userSpaceOnUse">'
    + '<rect width="6" height="3" fill="#ffffff" opacity=".045"/></pattern>'
    + '</defs>'
    + '<rect width="1200" height="675" fill="url(#bg)"/>'
    + '<rect width="1200" height="675" fill="url(#scan)"/>'
    // The same arcade glyph the app icon uses, so a game is recognisable as the
    // same thing on the canvas and on a home screen.
    + `<g fill="#ffffff" opacity=".9" transform="translate(830 96) scale(15)">`
    + '<rect x="2" y="0" width="1" height="1"/><rect x="8" y="0" width="1" height="1"/>'
    + '<rect x="3" y="1" width="1" height="1"/><rect x="7" y="1" width="1" height="1"/>'
    + '<rect x="2" y="2" width="7" height="1"/>'
    + '<rect x="1" y="3" width="2" height="1"/><rect x="4" y="3" width="3" height="1"/><rect x="8" y="3" width="2" height="1"/>'
    + '<rect x="0" y="4" width="11" height="1"/>'
    + '<rect x="0" y="5" width="1" height="1"/><rect x="2" y="5" width="7" height="1"/><rect x="10" y="5" width="1" height="1"/>'
    + '<rect x="0" y="6" width="1" height="1"/><rect x="2" y="6" width="1" height="1"/>'
    + '<rect x="8" y="6" width="1" height="1"/><rect x="10" y="6" width="1" height="1"/>'
    + '<rect x="3" y="7" width="2" height="1"/><rect x="6" y="7" width="2" height="1"/>'
    + '</g>'
    + `<text x="70" y="392" fill="#ffffff" font-family="system-ui,sans-serif" font-size="84" `
    + `font-weight="800" letter-spacing="-2">${escapeXml(title)}</text>`
    + (brief
      ? `<text x="70" y="440" fill="#ffffff" opacity=".72" font-family="system-ui,sans-serif" `
        + `font-size="26">${escapeXml(brief)}</text>`
      : '')
    + badges
    + '</svg>'
  );
}

/** The poster as a data URL an `<img src>` can display. */
export function gamePosterDataUrl(input: { title: string; brief?: string; html?: string }): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(gamePosterSvg(input))}`;
}
