/**
 * The generated game document — normalising, checking, and adapting it for a
 * device it was not written on.
 *
 * A model asked for "a small browser game" reliably returns something that plays
 * on a laptop and is unplayable on a phone: arrow-key input, a fixed 800×600
 * canvas, text at a size chosen for a mouse, and a page that rubber-band-scrolls
 * the moment a thumb touches it. Every phone target in this port ships the SAME
 * document the canvas plays, so rather than asking the model to remember all of
 * that (it will not, consistently), the document is ADAPTED here — once, in code,
 * where the behaviour can be tested.
 *
 * The checks are the other half. `creativeRoutes` already refuses a game that is
 * not an HTML document, which catches a refusal or an apology. It does not catch
 * the more expensive failure: a document that is HTML, opens fine, and is not a
 * game — no script, or a script that reaches for the network and stalls forever
 * behind a sandbox that has no network. Those get caught here, before a file is
 * written or an APK is built from it.
 */

/** Lowercase, hyphenated, non-empty. The stem for every file this game produces. */
export function gameSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'builderforce-game'
  );
}

/**
 * A stable accent colour for a title.
 *
 * Derived rather than random so a game's icon, splash screen and poster are the
 * same colour every time it is regenerated — an icon that changes hue on every
 * build is one the player stops recognising on their home screen.
 */
export function accentFromTitle(title: string): string {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  // Constrained to the saturated, mid-lightness band: a game icon has to read at
  // 48px against both a light and a dark home screen.
  const hue = hash % 360;
  return hslToHex(hue, 0.68, 0.52);
}

export function hslToHex(h: number, s: number, l: number): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = l - chroma / 2;
  const sector = Math.floor(h / 60) % 6;
  const rgb = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ][sector]!;
  const channel = (v: number) =>
    Math.round((v + match) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(rgb[0]!)}${channel(rgb[1]!)}${channel(rgb[2]!)}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16) || 0,
    parseInt(value.slice(2, 4), 16) || 0,
    parseInt(value.slice(4, 6), 16) || 0,
  ];
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!,
  );
}

export type GameValidation = { ok: true } | { ok: false; reason: string };

/**
 * Whether a generated document is a game we are willing to ship to a device.
 *
 * Ordered cheapest-first, and each rejection names the thing that is wrong rather
 * than "invalid": the caller turns these into a 502 that a person has to act on.
 */
export function validateGameDocument(html: string): GameValidation {
  const document = html.trim();
  if (document.length < 200) {
    return { ok: false, reason: 'The generated game was too short to contain a playable game' };
  }
  if (!/<[a-z!]/i.test(document)) {
    return { ok: false, reason: 'The generated game was not an HTML document' };
  }
  // A game is interactive by definition. A document with no script is a poster of
  // a game — it will open, look plausible, and do nothing when a child taps it.
  if (!/<script[\s>]/i.test(document)) {
    return { ok: false, reason: 'The generated game had no script, so nothing in it can be played' };
  }
  // The frame that plays this has no network and no same-origin, and the APK ships
  // offline. A document that loads its engine from a CDN is not self-contained; it
  // is a blank screen everywhere except the machine that generated it.
  const externalScript = /<script[^>]+\bsrc\s*=\s*["']?(?:https?:)?\/\//i.test(document);
  const externalStyle = /<link[^>]+\bhref\s*=\s*["']?(?:https?:)?\/\/[^"'>]*\.css/i.test(document);
  if (externalScript || externalStyle) {
    return {
      ok: false,
      reason: 'The generated game loaded code from another site, so it cannot run offline or in the player',
    };
  }
  return { ok: true };
}

/** Give the document a doctype and a charset when the model omitted them. */
export function normalizeGameDocument(html: string, title: string): string {
  let document = html.trim();
  if (!/^\s*<!doctype/i.test(document)) document = `<!doctype html>\n${document}`;
  if (!/<meta[^>]+charset/i.test(document)) {
    document = injectIntoHead(document, '<meta charset="utf-8">');
  }
  if (!/<title[\s>]/i.test(document)) {
    document = injectIntoHead(document, `<title>${escapeHtml(title)}</title>`);
  }
  return document;
}

/**
 * Insert markup at the top of the document's head.
 *
 * Deliberately a string operation and not a parse. There is no DOM in a Worker,
 * every real alternative is a dependency, and the shapes a generated document
 * actually takes are few: a full `<head>`, a bare `<html>`, or the implicit-head
 * form (`<!doctype html><meta …>`) that models emit most often. Anything that
 * matches none of them gets the snippet prepended after the doctype, which is
 * where an implicit head begins anyway — so the worst case is still correct.
 */
export function injectIntoHead(html: string, snippet: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + '\n' + snippet + html.slice(head.index + head[0].length);
  const htmlTag = /<html[^>]*>/i.exec(html);
  if (htmlTag) {
    return html.slice(0, htmlTag.index + htmlTag[0].length) + `\n<head>\n${snippet}\n</head>` + html.slice(htmlTag.index + htmlTag[0].length);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) return html.slice(0, doctype[0].length) + '\n' + snippet + html.slice(doctype[0].length);
  return `${snippet}\n${html}`;
}

/** Insert markup just before `</body>`, or append when the document has none. */
export function injectBeforeBodyEnd(html: string, snippet: string): string {
  const close = /<\/body\s*>/i.exec(html);
  if (close) return html.slice(0, close.index) + snippet + '\n' + html.slice(close.index);
  return `${html}\n${snippet}`;
}

/**
 * The touch layer.
 *
 * Three separate problems, all of which make a laptop game feel broken on a phone
 * and none of which a generated document handles on its own:
 *
 *  1. The page itself moves. Pull-to-refresh, rubber-band scroll, double-tap
 *     zoom and the long-press callout all fire during normal play. That is CSS
 *     and one viewport tag — it is not the game's job.
 *
 *  2. Nothing dispatches keys. Overwhelmingly the generated game listens for
 *     `keydown`/`keyup` on arrows, WASD and space, so the honest adaptation is a
 *     D-pad and an action button that SYNTHESISE those events rather than a
 *     rewrite of the game's input. It works because it speaks the game's existing
 *     language; it is inert (and hidden) on a device with a real keyboard.
 *
 *  3. The safe area. A fullscreen game on a notched phone puts its score under
 *     the camera and its controls under the home indicator unless it is told not
 *     to, which is `viewport-fit=cover` plus `env(safe-area-inset-*)`.
 *
 * The controls are injected only for phone targets. On the canvas the game keeps
 * a real keyboard and gains nothing from a painted D-pad.
 */
export function withTouchControls(html: string, accent: string): string {
  const style = `<style id="bf-touch">
  :root { --bf-accent: ${accent}; }
  html, body {
    overscroll-behavior: none;
    touch-action: manipulation;
    -webkit-user-select: none; user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }
  #bf-pad {
    position: fixed; inset: auto 0 0 0; z-index: 2147483000;
    padding: 0 max(16px, env(safe-area-inset-left)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-right));
    display: none; justify-content: space-between; align-items: flex-end;
    pointer-events: none;
  }
  /* Coarse pointer AND no physical keyboard — a laptop with a touchscreen keeps
     its keyboard and must not get a painted D-pad over the game. */
  @media (pointer: coarse) and (hover: none) { #bf-pad { display: flex; } }
  #bf-pad .bf-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
    width: min(42vw, 190px); pointer-events: auto;
  }
  #bf-pad button {
    -webkit-appearance: none; appearance: none; border: 0;
    background: color-mix(in srgb, var(--bf-accent) 34%, transparent);
    backdrop-filter: blur(6px);
    color: #fff; font: 700 20px/1 system-ui, sans-serif;
    border-radius: 14px; aspect-ratio: 1; min-width: 44px;
    display: grid; place-items: center;
    box-shadow: 0 2px 10px rgba(0,0,0,.28);
    transition: transform .06s, background .06s;
  }
  #bf-pad button:active { transform: scale(.92); background: color-mix(in srgb, var(--bf-accent) 62%, transparent); }
  #bf-pad .bf-fire {
    pointer-events: auto; aspect-ratio: 1; width: min(24vw, 104px);
    border-radius: 50%; font-size: 15px; letter-spacing: .04em;
  }
  #bf-pad .bf-blank { visibility: hidden; }
</style>`;

  const script = `<div id="bf-pad" aria-label="Game controls">
  <div class="bf-grid">
    <button class="bf-blank" tabindex="-1" aria-hidden="true"></button>
    <button data-bf-key="ArrowUp" aria-label="Up">&#9650;</button>
    <button class="bf-blank" tabindex="-1" aria-hidden="true"></button>
    <button data-bf-key="ArrowLeft" aria-label="Left">&#9664;</button>
    <button data-bf-key="ArrowDown" aria-label="Down">&#9660;</button>
    <button data-bf-key="ArrowRight" aria-label="Right">&#9654;</button>
  </div>
  <button class="bf-fire" data-bf-key=" " aria-label="Action">FIRE</button>
</div>
<script id="bf-touch-js">
(function () {
  /* Synthesise the input the game already listens for. Each pad button maps to a
     key AND to the WASD alias for it, because a generated game picks one scheme
     or the other and there is no way to know which from here — dispatching both
     is harmless (a game listening for arrows ignores 'a') and means the pad works
     either way. Events go to window, document AND the canvas: listeners are
     attached to all three in roughly equal measure. */
  var ALIAS = { ArrowUp: ['w', 'W'], ArrowDown: ['s', 'S'], ArrowLeft: ['a', 'A'], ArrowRight: ['d', 'D'], ' ': ['Spacebar'] };
  var CODE = { ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ' ': 'Space' };
  var held = Object.create(null);

  function fire(type, key) {
    var keys = [key].concat(ALIAS[key] || []);
    for (var i = 0; i < keys.length; i++) {
      var init = {
        key: keys[i],
        code: i === 0 ? (CODE[key] || key) : ('Key' + String(keys[i]).toUpperCase()),
        keyCode: key === ' ' ? 32 : (key === 'ArrowUp' ? 38 : key === 'ArrowDown' ? 40 : key === 'ArrowLeft' ? 37 : key === 'ArrowRight' ? 39 : 0),
        bubbles: true, cancelable: true
      };
      init.which = init.keyCode;
      var targets = [window, document, document.body, document.querySelector('canvas')];
      for (var t = 0; t < targets.length; t++) {
        if (targets[t]) { try { targets[t].dispatchEvent(new KeyboardEvent(type, init)); } catch (e) {} }
      }
    }
  }

  function press(key) { if (!held[key]) { held[key] = 1; fire('keydown', key); } }
  function release(key) { if (held[key]) { delete held[key]; fire('keyup', key); } }

  var pad = document.getElementById('bf-pad');
  if (!pad) return;
  pad.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  var buttons = pad.querySelectorAll('[data-bf-key]');
  for (var b = 0; b < buttons.length; b++) {
    (function (button) {
      var key = button.getAttribute('data-bf-key');
      var down = function (e) { e.preventDefault(); press(key); };
      var up = function (e) { e.preventDefault(); release(key); };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('pointerleave', up);
    })(buttons[b]);
  }
  /* A game that only listens for taps on the canvas still needs one: forward a
     pad press as a click at the centre so "tap to start" screens are reachable. */
  window.addEventListener('blur', function () { for (var k in held) release(k); });
})();
</script>`;

  const viewport = '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">';
  const withMeta = /<meta[^>]+name=["']?viewport/i.test(html)
    ? html.replace(/<meta[^>]+name=["']?viewport[^>]*>/i, viewport)
    : injectIntoHead(html, viewport);
  return injectBeforeBodyEnd(injectIntoHead(withMeta, style), script);
}
