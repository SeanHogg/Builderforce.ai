/**
 * Click-to-source picking — point at what you can see, and the Brain knows exactly
 * which element you mean.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * "Make this button bigger" used to mean describing an element the user was looking
 * at, and the model guessing which file it lived in. Competing products resolve a
 * clicked element back to its JSX node. That is what this does: the pick becomes the
 * ONE prompt's context (`lib/workspace/previewPick.ts`) — a chip in the composer, and
 * the exact file and line the next request is about — so the change goes through the
 * same Brain and the same transcript as every other one, with no search for the source.
 *
 * ── WHY NO BUILD-STEP CHANGE ────────────────────────────────────────────────
 * The obvious implementation is a Babel/SWC transform stamping
 * `data-loc="file:line:col"` onto every element, which means editing the user's
 * `vite.config.js` — arbitrary JavaScript this code would have to rewrite
 * correctly — and re-running it for every project that predates the feature.
 *
 * React already carries the answer. `@vitejs/plugin-react` enables the JSX source
 * transform in development, so every element created in dev has `__source`
 * ({ fileName, lineNumber, columnNumber }), which React hangs off the fiber as
 * `_debugSource`. Walking from a DOM node to its fiber is a property lookup. So
 * the mapping is free, exact, and works on a project created before this existed.
 *
 * It is also inherently DEV-ONLY, which is the right failure mode: the overlay is
 * injected into the MOUNTED copy of `index.html` for the dev server and never
 * into the user's files or a published build, so a production site can neither be
 * inspected this way nor ship the overlay.
 */

import { injectIntoHead } from '@/lib/previewInjection';

/** postMessage type carrying a selection out of the preview. Namespaced. */
export const VISUAL_SELECT_MESSAGE = 'builderforce:visual-select';

/**
 * postMessage type saying a click landed on an element with no source anchor — React
 * did not report where it was rendered (a production build, or a React version without
 * `_debugSource`). The host says so instead of the click doing nothing.
 */
export const VISUAL_UNRESOLVED_MESSAGE = 'builderforce:visual-unresolved';

/** postMessage type telling the preview to arm or disarm selection. */
export const VISUAL_ARM_MESSAGE = 'builderforce:visual-arm';

/**
 * postMessage type moving the preview through its own history. The frame is
 * cross-origin, so the toolbar's back / forward cannot call `history` directly;
 * the overlay already listening for {@link VISUAL_ARM_MESSAGE} does it.
 */
export const PREVIEW_NAV_MESSAGE = 'builderforce:preview-nav';

export type PreviewNavDirection = 'back' | 'forward';

/** Ask the preview in `frame` to go back or forward in its own history. */
export function navigatePreview(frame: HTMLIFrameElement | null, direction: PreviewNavDirection): void {
  frame?.contentWindow?.postMessage({ type: PREVIEW_NAV_MESSAGE, direction }, '*');
}

export interface VisualSelection {
  /** Source file as React reported it, normalised to workspace-relative. */
  file: string;
  line: number;
  column: number;
  /** Tag name, for the label the user sees. */
  tag: string;
  /** Current `class` attribute of the rendered element, or ''. */
  className: string;
  /** Visible text, when the element's content is a single text node. */
  text: string | null;
}

/**
 * The overlay injected into the preview document.
 *
 * Self-contained and defensive: it never throws into the app, it does not run
 * until armed, and it removes its own listeners when disarmed, so an app that is
 * being used normally is untouched by its presence.
 */
export const VISUAL_EDITOR_OVERLAY = `<script>
(function () {
  var SELECT = ${JSON.stringify(VISUAL_SELECT_MESSAGE)};
  var ARM = ${JSON.stringify(VISUAL_ARM_MESSAGE)};
  var NAV = ${JSON.stringify(PREVIEW_NAV_MESSAGE)};
  var UNRESOLVED = ${JSON.stringify(VISUAL_UNRESOLVED_MESSAGE)};
  var armed = false;
  var box = null;

  function outline() {
    if (box) return box;
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #4d9eff;background:rgba(77,158,255,.12);border-radius:3px;transition:all .05s';
    document.body.appendChild(box);
    return box;
  }

  function highlight(el) {
    var r = el.getBoundingClientRect(), b = outline();
    b.style.display = 'block';
    b.style.top = r.top + 'px'; b.style.left = r.left + 'px';
    b.style.width = r.width + 'px'; b.style.height = r.height + 'px';
  }

  // React hangs the fiber off the DOM node under a hashed key. \`_debugSource\` is
  // present in development builds because the JSX source transform runs there.
  function sourceOf(node) {
    for (var el = node; el; el = el.parentElement) {
      for (var key in el) {
        if (key.indexOf('__reactFiber$') !== 0 && key.indexOf('__reactInternalInstance$') !== 0) continue;
        for (var fiber = el[key]; fiber; fiber = fiber._debugOwner) {
          var src = fiber._debugSource;
          if (src && src.fileName) return { el: el, src: src };
        }
      }
    }
    return null;
  }

  function onMove(event) {
    if (!armed) return;
    var found = sourceOf(event.target);
    if (found) highlight(found.el);
  }

  function onClick(event) {
    if (!armed) return;
    event.preventDefault();
    event.stopPropagation();
    var found = sourceOf(event.target);
    if (!found) {
      try { parent.postMessage({ type: UNRESOLVED }, '*'); } catch (e) {}
      return;
    }
    var el = found.el;
    // Only a SINGLE text child is reported as the element's text: an element with
    // mixed children has no one string that names it.
    var text = (el.childNodes.length === 1 && el.firstChild.nodeType === 3)
      ? el.firstChild.nodeValue
      : null;
    try {
      parent.postMessage({ type: SELECT, payload: {
        file: found.src.fileName,
        line: found.src.lineNumber,
        column: found.src.columnNumber || 0,
        tag: String(el.tagName || '').toLowerCase(),
        className: el.getAttribute('class') || '',
        text: text
      } }, '*');
    } catch (e) {}
  }

  addEventListener('message', function (event) {
    if (!event.data) return;
    if (event.data.type === NAV) {
      try { if (event.data.direction === 'back') history.back(); else history.forward(); } catch (e) {}
      return;
    }
    if (event.data.type !== ARM) return;
    armed = !!event.data.armed;
    if (!armed && box) box.style.display = 'none';
    document.body.style.cursor = armed ? 'crosshair' : '';
  });

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
})();
</script>`;

/**
 * Inject the overlay into the mounted entry document. Same contract as the
 * preview error reporter: mounted copy only, never the file on disk.
 */
export function withVisualEditor(files: Record<string, string>): Record<string, string> {
  return injectIntoHead(files, VISUAL_EDITOR_OVERLAY);
}

/**
 * Normalise the filename React reports to a workspace-relative path.
 *
 * In a WebContainer the dev server's cwd is the project root, so `fileName` is
 * either already relative or an absolute path under it. Both are reduced to the
 * form the file API addresses.
 */
export function workspaceRelativePath(fileName: string): string {
  const normalised = fileName.replace(/\\/g, '/').replace(/^\/+/, '');
  const marker = normalised.lastIndexOf('/src/');
  if (marker >= 0) return normalised.slice(marker + 1);
  return normalised;
}

/** True for the preview's "that element has no source anchor" message. */
export function isVisualUnresolved(data: unknown): boolean {
  return !!data && typeof data === 'object' && (data as { type?: unknown }).type === VISUAL_UNRESOLVED_MESSAGE;
}

/** Parse a selection message from the preview frame, or null when not ours. */
export function visualSelectionFrom(data: unknown): VisualSelection | null {
  if (!data || typeof data !== 'object') return null;
  const envelope = data as { type?: unknown; payload?: unknown };
  if (envelope.type !== VISUAL_SELECT_MESSAGE) return null;
  const payload = envelope.payload as Partial<VisualSelection> | undefined;
  const file = typeof payload?.file === 'string' ? workspaceRelativePath(payload.file) : '';
  const line = Number(payload?.line);
  if (!file || !Number.isInteger(line) || line < 1) return null;
  return {
    file,
    line,
    column: Number.isInteger(Number(payload?.column)) ? Number(payload?.column) : 0,
    tag: typeof payload?.tag === 'string' ? payload.tag : 'element',
    className: typeof payload?.className === 'string' ? payload.className : '',
    text: typeof payload?.text === 'string' ? payload.text : null,
  };
}
