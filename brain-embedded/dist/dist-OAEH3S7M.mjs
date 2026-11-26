// ../packages/agent-tools/node_modules/.pnpm/unpdf@1.9.1/node_modules/unpdf/dist/index.mjs
function polyfillDOMMatrix() {
  if (typeof globalThis.DOMMatrix !== "undefined") return;
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      if (Array.isArray(init) && init.length === 6) {
        this.a = init[0];
        this.b = init[1];
        this.c = init[2];
        this.d = init[3];
        this.e = init[4];
        this.f = init[5];
      } else {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      }
    }
    translateSelf(tx, ty = 0) {
      this.e = this.a * tx + this.c * ty + this.e;
      this.f = this.b * tx + this.d * ty + this.f;
      return this;
    }
    scaleSelf(sx, sy = sx) {
      this.a *= sx;
      this.b *= sx;
      this.c *= sy;
      this.d *= sy;
      return this;
    }
  };
}
function stubBrowserGlobals() {
  polyfillDOMMatrix();
}
var resolvedModule;
var isNode = globalThis.process?.release?.name === "node";
var isBrowser = typeof window !== "undefined";
async function getDocumentProxy(data, options = {}) {
  const { getDocument } = await getResolvedPDFJS();
  let nodeDefaults = {};
  if (isNode) try {
    const base = import.meta.resolve("pdfjs-dist/package.json");
    nodeDefaults = {
      disableFontFace: true,
      standardFontDataUrl: new URL("./standard_fonts/", base).href,
      cMapUrl: new URL("./cmaps/", base).href,
      cMapPacked: true
    };
  } catch {
  }
  return await getDocument({
    data,
    useSystemFonts: true,
    ...nodeDefaults,
    ...options
  }).promise;
}
async function withDocument(data, operation, options) {
  const pdf = isPDFDocumentProxy(data) ? data : await getDocumentProxy(data, options);
  try {
    return await operation(pdf);
  } finally {
    if (pdf !== data) await pdf.loadingTask.destroy();
  }
}
async function getResolvedPDFJS() {
  if (!resolvedModule) await resolvePDFJSImport();
  return resolvedModule;
}
async function resolvePDFJSImport(pdfjsResolver, { reload = false } = {}) {
  if (resolvedModule && !reload) return;
  stubBrowserGlobals();
  if (pdfjsResolver) try {
    resolvedModule = await interopDefault(pdfjsResolver());
    return;
  } catch (error) {
    throw new Error(`PDF.js could not be resolved: ${error}`);
  }
  try {
    resolvedModule = await import("./pdfjs-GISNZN26.mjs");
  } catch (error) {
    throw new Error(`Serverless PDF.js bundle could not be resolved: ${error}`);
  }
}
function isPDFDocumentProxy(data) {
  return typeof data === "object" && data !== null && "_pdfInfo" in data;
}
async function interopDefault(m) {
  const resolved = await m;
  return resolved.default || resolved;
}
var resolvedCanvasModule;
var BaseCanvasFactory = class {
  #enableHWA = false;
  constructor({ enableHWA = false } = {}) {
    this.#enableHWA = enableHWA;
  }
  create(width, height) {
    const canvas = this._createCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext("2d", { willReadFrequently: !this.#enableHWA })
    };
  }
  reset({ canvas }, width, height) {
    if (!canvas) throw new Error("Canvas is not specified");
    canvas.width = width;
    canvas.height = height;
  }
  destroy(context) {
    if (!context.canvas) throw new Error("Canvas is not specified");
    context.canvas.width = 0;
    context.canvas.height = 0;
    context.canvas = void 0;
    context.context = void 0;
  }
  _createCanvas(width, height) {
    throw new Error("Not implemented");
  }
};
var DOMCanvasFactory = class extends BaseCanvasFactory {
  constructor({ ownerDocument = globalThis.document, enableHWA = false } = {}) {
    super({ enableHWA });
    this._document = ownerDocument;
  }
  _createCanvas(width, height) {
    const canvas = this._document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
};
var NodeCanvasFactory = class extends BaseCanvasFactory {
  constructor({ enableHWA = false } = {}) {
    super({ enableHWA });
  }
  _createCanvas(width, height) {
    if (!resolvedCanvasModule) throw new Error("@napi-rs/canvas module is not resolved");
    return resolvedCanvasModule.createCanvas(width, height);
  }
};
async function resolveCanvasModule(canvasImport) {
  resolvedCanvasModule ??= await interopDefault(canvasImport());
  globalThis[/* @__PURE__ */ Symbol.for("unpdf.canvasModule")] = resolvedCanvasModule;
}
function injectCanvasConstructors() {
  if (!resolvedCanvasModule) return;
  globalThis.DOMMatrix = resolvedCanvasModule.DOMMatrix;
  if (typeof globalThis.ImageData === "undefined") globalThis.ImageData = resolvedCanvasModule.ImageData;
  if (typeof globalThis.Path2D === "undefined") globalThis.Path2D = resolvedCanvasModule.Path2D;
}
async function extractImages$1(data, pageNumber) {
  return await withDocument(data, async (pdf) => {
    if (pageNumber < 1 || pageNumber > pdf.numPages) throw new Error(`Invalid page number. Must be between 1 and ${pdf.numPages}.`);
    const page = await pdf.getPage(pageNumber);
    const operatorList = await page.getOperatorList();
    const { OPS } = await getResolvedPDFJS();
    const images = [];
    for (let i = 0; i < operatorList.fnArray.length; i++) {
      if (operatorList.fnArray[i] !== OPS.paintImageXObject) continue;
      const imageKey = operatorList.argsArray[i][0];
      const image = await new Promise((resolve) => (imageKey.startsWith("g_") ? page.commonObjs : page.objs).get(imageKey, resolve));
      if (!image || !image.data || !image.width || !image.height) continue;
      const { width, height, data: data2 } = image;
      const calculatedChannels = data2.length / (width * height);
      if (![
        1,
        3,
        4
      ].includes(calculatedChannels)) continue;
      const channels = calculatedChannels;
      images.push({
        data: data2,
        width,
        height,
        channels,
        key: imageKey
      });
    }
    return images;
  });
}
async function renderPageAsImage$1(data, pageNumber, options = {}) {
  const CanvasFactory = await createIsomorphicCanvasFactory(options.canvasImport);
  return await withDocument(data, async (pdf) => {
    if (pageNumber < 1 || pageNumber > pdf.numPages) throw new Error(`Invalid page number. Must be between 1 and ${pdf.numPages}.`);
    const page = await pdf.getPage(pageNumber);
    const defaultViewport = page.getViewport({ scale: 1 });
    let scale = options.scale || 1;
    if (options.width) scale = options.width / defaultViewport.width;
    else if (options.height) scale = options.height / defaultViewport.height;
    const viewport = page.getViewport({ scale: Math.max(0, scale) });
    const canvasFactory = new CanvasFactory();
    const drawingContext = canvasFactory.create(viewport.width, viewport.height);
    try {
      await page.render({
        canvas: drawingContext.canvas,
        canvasContext: drawingContext.context,
        viewport
      }).promise;
      const { canvas } = drawingContext;
      if (options.toDataURL) return canvas.toDataURL();
      if ("encode" in canvas) {
        const buffer = await canvas.encode("png");
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      }
      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve);
      });
      if (!blob) throw new Error("Failed to encode canvas to a PNG blob.");
      return await blob.arrayBuffer();
    } finally {
      canvasFactory.destroy(drawingContext);
    }
  }, { CanvasFactory });
}
async function createIsomorphicCanvasFactory(canvasImport) {
  if (isBrowser) return DOMCanvasFactory;
  if (isNode) {
    if (!canvasImport) throw new Error('Parameter "canvasImport" is required in Node.js environment.');
    await resolveCanvasModule(canvasImport);
    injectCanvasConstructors();
    return NodeCanvasFactory;
  }
  throw new Error("Unsupported environment for canvas creation.");
}
async function extractLinks$1(data) {
  return await withDocument(data, async (pdf) => {
    const pageLinks = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => getPageLinks(pdf, i + 1)));
    return {
      totalPages: pdf.numPages,
      links: pageLinks.flat()
    };
  });
}
async function getPageLinks(document, pageNumber) {
  const annotations = await (await document.getPage(pageNumber)).getAnnotations();
  const links = [];
  for (const annotation of annotations) if (annotation.subtype === "Link" && annotation.url) links.push(annotation.url);
  return links;
}
var XMP_DATE_PROPERTIES = [
  "xmp:createdate",
  "xmp:modifydate",
  "xmp:metadatadate",
  "xap:createdate",
  "xap:modifydate",
  "xap:metadatadate"
];
async function getMeta$1(data, options = {}) {
  return await withDocument(data, async (pdf) => {
    const meta = await pdf.getMetadata();
    const info = { ...meta.info };
    let metadata = meta.metadata;
    if (options.parseDates) {
      const { PDFDateString } = await getResolvedPDFJS();
      if (info.CreationDate) info.CreationDate = PDFDateString.toDateObject(info.CreationDate);
      if (info.ModDate) info.ModDate = PDFDateString.toDateObject(info.ModDate);
      if (metadata) {
        const Metadata = metadata.constructor;
        metadata = new Metadata({
          parsedData: new Map(Array.from(metadata, ([name, value]) => [name, XMP_DATE_PROPERTIES.includes(name) && value ? parseISODateString(value) : value])),
          rawData: metadata.getRaw()
        });
      }
    }
    return {
      info,
      metadata: metadata || {}
    };
  });
}
function parseISODateString(isoDateString) {
  if (!isoDateString) return;
  const parsedDate = Date.parse(isoDateString);
  if (!Number.isNaN(parsedDate)) return new Date(parsedDate);
}
async function extractTextItems$1(data) {
  return await withDocument(data, async (pdf) => {
    const items = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => getPageTextItems(pdf, i + 1)));
    return {
      totalPages: pdf.numPages,
      items
    };
  });
}
async function getPageTextItems(document, pageNumber) {
  const content = await (await document.getPage(pageNumber)).getTextContent();
  const styles = content.styles;
  return content.items.filter((item) => item.str != null).map((item) => {
    const [_a, _b, c, d, e, f] = item.transform;
    return {
      str: item.str,
      x: e,
      y: f,
      width: item.width,
      height: item.height,
      fontSize: Math.hypot(c, d),
      fontFamily: styles[item.fontName]?.fontFamily ?? "",
      dir: item.dir,
      hasEOL: item.hasEOL
    };
  });
}
async function extractText$1(data, options = {}) {
  const { mergePages = false } = options;
  return await withDocument(data, async (pdf) => {
    const texts = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => getPageText(pdf, i + 1)));
    return {
      totalPages: pdf.numPages,
      text: mergePages ? normalizeMergedText(texts) : texts
    };
  });
}
async function getPageText(document, pageNumber) {
  return (await (await document.getPage(pageNumber)).getTextContent()).items.filter((item) => item.str != null).map((item) => item.str + (item.hasEOL ? "\n" : "")).join("");
}
function normalizeMergedText(texts) {
  return texts.join("\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
}
async function definePDFJSModule(pdfjs) {
  await resolvePDFJSImport(pdfjs, { reload: true });
}
async function configureUnPDF(options) {
  await resolvePDFJSImport(options.pdfjs, { reload: true });
}
var getMeta = async (...args) => {
  await resolvePDFJSImport();
  return await getMeta$1(...args);
};
var extractText = async (...args) => {
  await resolvePDFJSImport();
  return await extractText$1(...args);
};
var extractTextItems = async (...args) => {
  await resolvePDFJSImport();
  return await extractTextItems$1(...args);
};
var extractImages = async (...args) => {
  await resolvePDFJSImport();
  return await extractImages$1(...args);
};
var renderPageAsImage = async (...args) => {
  await resolvePDFJSImport();
  return await renderPageAsImage$1(...args);
};
var extractLinks = async (...args) => {
  await resolvePDFJSImport();
  return await extractLinks$1(...args);
};
export {
  configureUnPDF,
  createIsomorphicCanvasFactory,
  definePDFJSModule,
  extractImages,
  extractLinks,
  extractText,
  extractTextItems,
  getDocumentProxy,
  getMeta,
  getResolvedPDFJS,
  renderPageAsImage,
  resolvePDFJSImport
};
/*! Bundled license information:

unpdf/dist/index.mjs:
  (**
  * Derived from the PDF.js project by the Mozilla Foundation.
  * @see https://github.com/mozilla/pdf.js/blob/b8de9a372f9bbf7e33adb362eeae5ef1919dba73/src/display/canvas_factory.js#L18
  * @license Apache-2.0
  *)
*/
//# sourceMappingURL=dist-OAEH3S7M.mjs.map