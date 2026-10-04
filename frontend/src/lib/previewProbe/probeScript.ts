/**
 * The REVIEW PROBE — what lets the Studio's agent look at the app it just changed.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 * Measured on chat #129 (Studio, "Build a marketing website for he-man"): the agent
 * fixed a pill that stretched to full card height and rebuilt the mobile layout, then
 * filed both tickets and stopped at `in_review` (75%). It had no way to know whether
 * either fix worked. Its only window on the running app was
 * `canvas_read_build_diagnostics` — "no errors recorded" — and a layout bug is not an
 * error. So it tried to dispatch a QA agent (refused: execution switched off), and the
 * tickets sat in review with nobody able to ever move them.
 *
 * The preview is RIGHT THERE, running in this browser. This script is injected into it
 * (mounted copy only — see `previewInjection.ts`) and answers one question on request:
 * "at this viewport, what is actually on screen?" — the measurements a reviewer would
 * take with devtools open. The host loads the preview in a hidden frame at each width
 * it wants checked (`runPreviewProbe.ts`), asks, and hands the model numbers instead of
 * a guess.
 *
 * ── WHY MEASUREMENTS AND NOT A SCREENSHOT ───────────────────────────────────
 * Tool results reach the model as text. A pixel capture of a cross-origin frame is not
 * possible from the host anyway, and "the tag is 23px tall and hugs its label" is a
 * stronger review than a picture the model would have to eyeball: it is exact, it is
 * comparable before/after, and it names the element.
 *
 * ES5, self-contained and inert until asked: it adds one `message` listener and one
 * error listener and touches nothing in the app.
 */

import { injectIntoHead } from '@/lib/previewInjection';

/** Host → preview: measure now. Namespaced so nothing else claims it. */
export const PREVIEW_PROBE_REQUEST = 'builderforce:probe-request';

/** Preview → host: the measurements, echoing the request id. */
export const PREVIEW_PROBE_RESULT = 'builderforce:probe-result';

/** Most elements reported per finding list, so a broken page cannot flood the result. */
export const PROBE_LIST_CAP = 8;

/** Most matches described per requested selector. */
export const PROBE_MATCH_CAP = 5;

/** Smallest comfortable touch target (WCAG 2.5.5 AAA / platform guidance), in CSS px. */
export const MIN_TAP_TARGET_PX = 44;

export const PREVIEW_PROBE_SCRIPT = `<script>
(function () {
  var REQUEST = ${JSON.stringify(PREVIEW_PROBE_REQUEST)};
  var RESULT = ${JSON.stringify(PREVIEW_PROBE_RESULT)};
  var CAP = ${PROBE_LIST_CAP};
  var MATCH_CAP = ${PROBE_MATCH_CAP};
  var MIN_TAP = ${MIN_TAP_TARGET_PX};
  var errors = [];

  window.addEventListener('error', function (event) {
    if (errors.length >= CAP) return;
    if (event.target && event.target !== window && event.target.tagName) {
      errors.push('Failed to load ' + String(event.target.tagName).toLowerCase() + ': ' + (event.target.src || event.target.href || 'unknown'));
    } else {
      errors.push(String(event.message || 'Uncaught error'));
    }
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    if (errors.length >= CAP) return;
    var reason = event.reason;
    errors.push('Unhandled promise rejection: ' + (reason && reason.message ? reason.message : String(reason)));
  });

  function round(n) { return Math.round(n); }

  function describe(el) {
    var parts = [];
    for (var node = el, depth = 0; node && node.nodeType === 1 && depth < 3; node = node.parentElement, depth++) {
      var tag = String(node.tagName).toLowerCase();
      if (tag === 'html' || tag === 'body') break;
      var part = tag;
      if (node.id) { parts.unshift(part + '#' + node.id); break; }
      var cls = typeof node.className === 'string' ? node.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
      if (cls) part += '.' + cls;
      parts.unshift(part);
    }
    return parts.join(' > ') || String(el.tagName).toLowerCase();
  }

  function visible(el, style) {
    style = style || getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // An element past the viewport edge only matters when nothing between it and the
  // page clips it: a carousel track inside an overflow:hidden strip is by design.
  function clippedByAncestor(el, vw) {
    for (var node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      var ox = getComputedStyle(node).overflowX;
      if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') {
        var r = node.getBoundingClientRect();
        if (r.right <= vw + 1 && r.left >= -1) return true;
      }
    }
    return false;
  }

  function text(el) {
    return String(el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  }

  function styleOf(style) {
    return {
      display: style.display, position: style.position,
      width: style.width, height: style.height,
      flex: style.flex, alignSelf: style.alignSelf,
      overflowX: style.overflowX, fontSize: style.fontSize, lineHeight: style.lineHeight,
      color: style.color, backgroundColor: style.backgroundColor,
      zIndex: style.zIndex, transform: style.transform
    };
  }

  function occluder(el, rect, vw, vh) {
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) return null;
    var top = document.elementFromPoint(cx, cy);
    if (!top || top === el || el.contains(top) || top.contains(el)) return null;
    return describe(top);
  }

  function inspect(selector, vw, vh) {
    var list;
    try { list = document.querySelectorAll(selector); } catch (e) { return { selector: selector, error: 'Invalid CSS selector' }; }
    var matches = [];
    for (var i = 0; i < list.length && matches.length < MATCH_CAP; i++) {
      var el = list[i], style = getComputedStyle(el), r = el.getBoundingClientRect();
      var shown = visible(el, style);
      matches.push({
        element: describe(el), text: text(el), visible: shown,
        rect: { x: round(r.left), y: round(r.top), width: round(r.width), height: round(r.height) },
        inViewport: r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw,
        style: styleOf(style),
        occludedBy: shown ? occluder(el, r, vw, vh) : null
      });
    }
    return { selector: selector, count: list.length, matches: matches };
  }

  function measure(selectors) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var root = document.documentElement, body = document.body;
    var scrollWidth = Math.max(root.scrollWidth, body ? body.scrollWidth : 0);
    var all = body ? body.getElementsByTagName('*') : [];
    var overflowing = [], smallTargets = [], clippedText = [], brokenImages = [], imagesWithoutAlt = [];
    var limit = Math.min(all.length, 5000);
    for (var i = 0; i < limit; i++) {
      var el = all[i];
      var tag = String(el.tagName).toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta') continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      var style = getComputedStyle(el);
      if (!visible(el, style)) continue;

      if ((r.right > vw + 1 || r.left < -1) && !clippedByAncestor(el, vw)) {
        var parent = el.parentElement;
        var pr = parent ? parent.getBoundingClientRect() : null;
        // Report the OUTERMOST culprit: a child of an element already past the edge
        // is a symptom, not the cause.
        if (!pr || parent === body || !(pr.right > vw + 1 || pr.left < -1)) {
          overflowing.push({ element: describe(el), left: round(r.left), right: round(r.right), width: round(r.width), position: style.position });
        }
      }

      if ((tag === 'a' && el.hasAttribute('href')) || tag === 'button' || tag === 'select' || el.getAttribute('role') === 'button'
          || (tag === 'input' && el.type !== 'hidden')) {
        if (r.width < MIN_TAP || r.height < MIN_TAP) {
          smallTargets.push({ element: describe(el), text: text(el), width: round(r.width), height: round(r.height) });
        }
      }

      if ((style.overflowX === 'hidden' || style.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1 && text(el)) {
        clippedText.push({ element: describe(el), text: text(el), visibleWidth: el.clientWidth, contentWidth: el.scrollWidth });
      }

      if (tag === 'img') {
        if (el.complete && el.naturalWidth === 0 && el.getAttribute('src')) brokenImages.push({ element: describe(el), src: String(el.getAttribute('src')).slice(0, 200) });
        if (!el.hasAttribute('alt')) imagesWithoutAlt.push({ element: describe(el), src: String(el.getAttribute('src') || '').slice(0, 200) });
      }
    }
    overflowing.sort(function (a, b) { return Math.max(b.right - vw, -b.left) - Math.max(a.right - vw, -a.left); });
    var rootStyle = getComputedStyle(root), bodyStyle = body ? getComputedStyle(body) : rootStyle;
    return {
      url: location.pathname + location.search + location.hash,
      title: document.title,
      viewport: { width: vw, height: vh },
      documentWidth: scrollWidth,
      documentHeight: Math.max(root.scrollHeight, body ? body.scrollHeight : 0),
      pageOverflowXHidden: rootStyle.overflowX === 'hidden' || bodyStyle.overflowX === 'hidden' || rootStyle.overflowX === 'clip' || bodyStyle.overflowX === 'clip',
      overflowing: overflowing.slice(0, CAP), overflowingCount: overflowing.length,
      smallTargets: smallTargets.slice(0, CAP), smallTargetCount: smallTargets.length,
      clippedText: clippedText.slice(0, CAP), clippedTextCount: clippedText.length,
      brokenImages: brokenImages.slice(0, CAP),
      imagesWithoutAlt: imagesWithoutAlt.slice(0, CAP), imagesWithoutAltCount: imagesWithoutAlt.length,
      errors: errors.slice(0, CAP),
      selectors: (selectors || []).slice(0, 10).map(function (s) { return inspect(String(s), vw, vh); })
    };
  }

  addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== REQUEST) return;
    var reply = function () {
      var report;
      try { report = measure(data.selectors); } catch (e) { report = { error: String(e && e.message || e) }; }
      try { event.source.postMessage({ type: RESULT, id: data.id, report: report }, '*'); } catch (e) {}
    };
    // Web fonts change line boxes; measure after they settle, but never wait on them
    // forever. setTimeout rather than requestAnimationFrame: a hidden cross-origin
    // frame may be render-throttled, and layout reads force a synchronous layout anyway.
    var done = false;
    var once = function () { if (!done) { done = true; setTimeout(reply, 50); } };
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(once, once); } catch (e) {}
    setTimeout(once, 1500);
  });
})();
</script>`;

/** Inject the probe into the mounted entry document. Mounted copy only — see {@link injectIntoHead}. */
export function withPreviewProbe(files: Record<string, string>): Record<string, string> {
  return injectIntoHead(files, PREVIEW_PROBE_SCRIPT);
}
