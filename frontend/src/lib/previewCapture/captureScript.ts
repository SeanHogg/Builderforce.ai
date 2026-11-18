/**
 * The PREVIEW CAPTURE script — how `runtime.preview_screenshot` sees a browser run.
 *
 * The host cannot paint a cross-origin frame, and the preview is on the relay origin.
 * So the capture happens INSIDE the page: this script is installed into the run's
 * preview pages (`setPreviewScripts`, removed again when the run stops), and when its
 * parent asks, it renders its own document to an image — the live DOM serialised into
 * an SVG `foreignObject` and drawn onto a canvas — and posts the JPEG to the parent.
 *
 * An SVG image cannot load anything itself, so before serialising, the page's own
 * resources are INLINED as data URLs: same-origin `<img>` sources, and `url(…)`
 * references (backgrounds, fonts) in its readable stylesheets. Cross-origin images
 * and stylesheets the page may not read stay out of the picture; nothing is faked.
 * A browser that refuses to read back the drawn canvas (Safari's SecurityError) is
 * answered with {@link PREVIEW_CAPTURE_UNSUPPORTED}, which the host words plainly.
 *
 * Only the parent may ask, and each request id is answered once. ES5 syntax,
 * self-contained, inert until asked: one `message` listener.
 */

/** Host → preview: capture now. */
export const PREVIEW_CAPTURE_REQUEST = 'builderforce:capture-request';

/** Preview → host: the image, echoing the request id. */
export const PREVIEW_CAPTURE_RESULT = 'builderforce:capture-result';

/** The in-page error a browser that cannot read back a rendered page answers with. */
export const PREVIEW_CAPTURE_UNSUPPORTED = 'capture-unsupported';

/** JPEG quality of a capture. */
export const PREVIEW_CAPTURE_QUALITY = 0.8;

/** Bytes of resources inlined into one capture, at most. */
export const PREVIEW_CAPTURE_INLINE_BYTES = 6 * 1024 * 1024;

export const PREVIEW_CAPTURE_SCRIPT = `(function () {
  var REQUEST = ${JSON.stringify(PREVIEW_CAPTURE_REQUEST)};
  var RESULT = ${JSON.stringify(PREVIEW_CAPTURE_RESULT)};
  var UNSUPPORTED = ${JSON.stringify(PREVIEW_CAPTURE_UNSUPPORTED)};
  var QUALITY = ${PREVIEW_CAPTURE_QUALITY};
  var INLINE_BYTES = ${PREVIEW_CAPTURE_INLINE_BYTES};
  var answered = {};

  function sameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }

  // One fetch per resource, within the byte budget; a miss leaves the reference as it was.
  function inliner() {
    var cache = {};
    var spent = 0;
    return function (url) {
      var absolute;
      try { absolute = new URL(url, location.href).href; } catch (e) { return Promise.resolve(null); }
      if (!sameOrigin(absolute) || absolute.indexOf('data:') === 0) return Promise.resolve(null);
      if (!cache[absolute]) {
        cache[absolute] = fetch(absolute).then(function (res) { return res.ok ? res.blob() : null; }).then(function (blob) {
          if (!blob || spent + blob.size > INLINE_BYTES) return null;
          spent += blob.size;
          return new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result)); };
            reader.onerror = function () { resolve(null); };
            reader.readAsDataURL(blob);
          });
        }).catch(function () { return null; });
      }
      return cache[absolute];
    };
  }

  function inlineCss(inline) {
    var texts = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      try {
        var rules = document.styleSheets[i].cssRules;
        for (var j = 0; j < rules.length; j++) texts.push(rules[j].cssText);
      } catch (e) { /* a cross-origin sheet: not readable, left out */ }
    }
    var css = texts.join('\\n');
    var refs = [];
    css.replace(/url\\((['"]?)([^'")]+)\\1\\)/g, function (match, quote, url) { refs.push(url); return match; });
    return Promise.all(refs.map(function (url) {
      return inline(url).then(function (data) { if (data) css = css.split(url).join(data); });
    })).then(function () { return css; });
  }

  function inlineImages(clone, inline) {
    var images = clone.querySelectorAll('img');
    var jobs = [];
    for (var i = 0; i < images.length; i++) {
      (function (img) {
        var src = img.getAttribute('src');
        if (!src) return;
        jobs.push(inline(src).then(function (data) { if (data) img.setAttribute('src', data); }));
      })(images[i]);
    }
    return Promise.all(jobs);
  }

  function post(target, id, result) {
    target.postMessage({ type: RESULT, id: id, result: result }, '*');
  }

  function draw(target, id, markup, width, height) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">'
      + '<foreignObject x="0" y="' + (-window.scrollY) + '" width="100%" height="' + (document.documentElement.scrollHeight || height) + '">'
      + markup + '</foreignObject></svg>';
    var image = new Image();
    image.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0);
      try {
        post(target, id, { imageDataUrl: canvas.toDataURL('image/jpeg', QUALITY), width: width, height: height, url: location.href });
      } catch (e) {
        post(target, id, { error: e && e.name === 'SecurityError' ? UNSUPPORTED : String((e && e.message) || e) });
      }
    };
    image.onerror = function () { post(target, id, { error: 'the page could not be rendered to an image' }); };
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function capture(target, id) {
    try {
      var width = document.documentElement.clientWidth || window.innerWidth;
      var height = window.innerHeight;
      var clone = document.documentElement.cloneNode(true);
      var drop = clone.querySelectorAll('script, link[rel="stylesheet"]');
      for (var k = 0; k < drop.length; k++) drop[k].parentNode.removeChild(drop[k]);
      var inline = inliner();
      Promise.all([inlineCss(inline), inlineImages(clone, inline)]).then(function (done) {
        var style = document.createElement('style');
        style.textContent = done[0];
        (clone.querySelector('head') || clone).appendChild(style);
        draw(target, id, new XMLSerializer().serializeToString(clone), width, height);
      }).catch(function (e) { post(target, id, { error: String((e && e.message) || e) }); });
    } catch (e) {
      post(target, id, { error: String((e && e.message) || e) });
    }
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== REQUEST || typeof data.id !== 'string') return;
    if (event.source !== window.parent || answered[data.id]) return;
    answered[data.id] = true;
    capture(event.source, data.id);
  });
})();`;
