/**
 * Click-to-source editing — change what you can see without spending a model turn.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * Every cosmetic change cost a full agent turn. "Make this button bigger" meant
 * describing an element the user was pointing at, the model guessing which file
 * it lived in, and a write — the most expensive possible way to change one
 * Tailwind class or one line of copy. Competing products resolve a clicked
 * element back to its JSX node and edit the source directly, reserving the model
 * for structural work. That is what this is.
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
 *
 * ── WHY THE EDITS ARE THIS NARROW ───────────────────────────────────────────
 * Two operations only: the element's visible TEXT, and its `className`. Both are
 * unambiguous single-line, single-attribute changes anchored to a line React
 * itself reported, so the edit either matches exactly or is refused. Anything
 * structural — moving a node, adding a prop, changing a handler — stays with the
 * model, where the reasoning belongs. A visual editor that tries to do more than
 * this is how a file gets silently rewritten by a regex.
 */

/** postMessage type carrying a selection out of the preview. Namespaced. */
export const VISUAL_SELECT_MESSAGE = 'builderforce:visual-select';

/** postMessage type telling the preview to arm or disarm selection. */
export const VISUAL_ARM_MESSAGE = 'builderforce:visual-arm';

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
    if (!found) return;
    var el = found.el;
    // Only a SINGLE text child is offered for editing: an element with mixed
    // children has no one string that is safely replaceable in source.
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
    if (!event.data || event.data.type !== ARM) return;
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
  const html = files['index.html'];
  if (typeof html !== 'string' || !html.includes('<head')) return files;
  const headEnd = html.indexOf('>', html.indexOf('<head'));
  if (headEnd === -1) return files;
  return {
    ...files,
    'index.html': `${html.slice(0, headEnd + 1)}\n${VISUAL_EDITOR_OVERLAY}${html.slice(headEnd + 1)}`,
  };
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

export type LineEdit =
  | { ok: true; content: string }
  | { ok: false; reason: string };

/**
 * Replace the `className` (or `class`) attribute on the selected line.
 *
 * Anchored to the line React reported, and only the FIRST attribute on it is
 * touched — a line holding two elements is refused rather than guessed at,
 * because getting that wrong edits an element the user was not pointing at.
 */
export function replaceClassNameAtLine(source: string, line: number, next: string): LineEdit {
  const lines = source.split('\n');
  const index = line - 1;
  if (index < 0 || index >= lines.length) return { ok: false, reason: 'That line is no longer in the file. Re-run the preview and pick the element again.' };
  const target = lines[index];
  const attribute = /(\bclassName|\bclass)\s*=\s*(["'])([^"']*)\2/;
  const match = attribute.exec(target);
  if (!match) {
    // No attribute yet: add one to the opening tag on this line.
    const tag = /<([A-Za-z][\w.]*)/.exec(target);
    if (!tag) return { ok: false, reason: 'That line has no element to style. Ask the agent to make this change instead.' };
    const at = tag.index + tag[0].length;
    lines[index] = `${target.slice(0, at)} className="${next}"${target.slice(at)}`;
    return { ok: true, content: lines.join('\n') };
  }
  if (attribute.exec(target.slice(match.index + match[0].length))) {
    return { ok: false, reason: 'That line holds more than one element. Ask the agent to make this change instead.' };
  }
  lines[index] = target.slice(0, match.index)
    + `${match[1]}=${match[2]}${next}${match[2]}`
    + target.slice(match.index + match[0].length);
  return { ok: true, content: lines.join('\n') };
}

/**
 * Replace an element's visible text.
 *
 * Matched by the EXACT current text rather than by position, and only when it
 * occurs once on the line — the same refuse-rather-than-guess rule the class edit
 * uses, and the reason this is safe to run without a model checking it.
 */
export function replaceTextAtLine(source: string, line: number, current: string, next: string): LineEdit {
  const lines = source.split('\n');
  const index = line - 1;
  if (index < 0 || index >= lines.length) return { ok: false, reason: 'That line is no longer in the file. Re-run the preview and pick the element again.' };
  const trimmed = current.trim();
  if (!trimmed) return { ok: false, reason: 'That element has no editable text.' };

  // The text may sit on the reported line or, for a multi-line element, just
  // after it. Search a small window rather than only one line.
  for (let offset = 0; offset < 4 && index + offset < lines.length; offset += 1) {
    const at = index + offset;
    const occurrences = lines[at].split(trimmed).length - 1;
    if (occurrences === 0) continue;
    if (occurrences > 1) return { ok: false, reason: 'That text appears more than once on the line. Ask the agent to make this change instead.' };
    const start = lines[at].indexOf(trimmed);
    lines[at] = lines[at].slice(0, start) + next + lines[at].slice(start + trimmed.length);
    return { ok: true, content: lines.join('\n') };
  }
  return { ok: false, reason: 'That text is not in the source at this position — it may be computed. Ask the agent to make this change instead.' };
}
