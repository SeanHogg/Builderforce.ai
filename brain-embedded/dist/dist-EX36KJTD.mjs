// ../../.pipeline-validation/node_modules/unpdf/dist/index.mjs
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
var pdfjsLoader;
var resolvedModule;
var isWasmCompilable;
var isNode = isNodeProcess(globalThis.process);
async function getDocumentProxy(data, options = {}) {
  const { getDocument } = await getResolvedPDFJS();
  if (globalThis.Buffer?.isBuffer(data)) data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let nodeDefaults = {};
  if (isNode) try {
    const nodeProcess = globalThis.process;
    const { dirname, join } = nodeProcess.getBuiltinModule("node:path");
    const { fileURLToPath } = nodeProcess.getBuiltinModule("node:url");
    const pdfjsDir = dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")));
    nodeDefaults = {
      useSystemFonts: false,
      standardFontDataUrl: `${join(pdfjsDir, "standard_fonts")}/`,
      cMapUrl: `${join(pdfjsDir, "cmaps")}/`,
      cMapPacked: true,
      wasmUrl: `${join(pdfjsDir, "wasm")}/`
    };
  } catch {
  }
  return await getDocument({
    data,
    useSystemFonts: true,
    useWasm: canCompileWasm(),
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
function definePDFJSModule(pdfjs) {
  pdfjsLoader = pdfjs;
  resolvedModule = void 0;
}
function getResolvedPDFJS() {
  resolvedModule ??= loadPDFJS(pdfjsLoader).catch((error) => {
    resolvedModule = void 0;
    throw error;
  });
  return resolvedModule;
}
function isPDFDocumentProxy(data) {
  return typeof data === "object" && data !== null && "_pdfInfo" in data;
}
async function interopDefault(m) {
  const resolved = await m;
  return resolved.default || resolved;
}
async function loadPDFJS(loader) {
  try {
    const pdfjs = await interopDefault(loader ? loader() : import("./pdfjs-2TZ3KHKI.mjs"));
    polyfillDOMMatrix();
    return pdfjs;
  } catch (error) {
    throw new Error(`PDF.js could not be resolved: ${error}`, { cause: error });
  }
}
function canCompileWasm() {
  if (isWasmCompilable === void 0) try {
    new WebAssembly.Module(new Uint8Array([
      0,
      97,
      115,
      109,
      1,
      0,
      0,
      0
    ]));
    isWasmCompilable = true;
  } catch {
    isWasmCompilable = false;
  }
  return isWasmCompilable;
}
function isNodeProcess(nodeProcess) {
  return typeof nodeProcess === "object" && `${nodeProcess}` === "[object process]" && !nodeProcess.versions.nw && !(nodeProcess.versions.electron && nodeProcess.type && nodeProcess.type !== "browser");
}
var resolvedCanvasModule;
async function resolveCanvasModule(canvasImport) {
  resolvedCanvasModule ??= await interopDefault(canvasImport());
  globalThis[/* @__PURE__ */ Symbol.for("unpdf.canvasModule")] = resolvedCanvasModule;
}
function injectCanvasConstructors() {
  if (!resolvedCanvasModule) return;
  globalThis.DOMMatrix = resolvedCanvasModule.DOMMatrix;
  if (typeof globalThis.Path2D === "undefined") globalThis.Path2D = resolvedCanvasModule.Path2D;
}
var IDENTITY_MATRIX = [
  1,
  0,
  0,
  1,
  0,
  0
];
function* walkOperatorList(operatorList, ops, optionalContentConfig) {
  const stateStack = [];
  let state = {
    transform: IDENTITY_MATRIX,
    textRenderingMode: 0
  };
  const softMaskGroupFlags = [];
  const contentVisibilityFlags = [];
  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const fn = operatorList.fnArray[i];
    const args = operatorList.argsArray[i];
    if (fn === ops.save) stateStack.push(state);
    else if (fn === ops.restore || fn === ops.paintFormXObjectEnd || fn === ops.endAnnotation) state = stateStack.pop() ?? state;
    else if (fn === ops.transform) state = {
      ...state,
      transform: multiplyMatrices(state.transform, args)
    };
    else if (fn === ops.paintFormXObjectBegin) {
      stateStack.push(state);
      const [formMatrix] = args;
      if (formMatrix) state = {
        ...state,
        transform: multiplyMatrices(state.transform, formMatrix)
      };
    } else if (fn === ops.beginAnnotation) {
      stateStack.push(state);
      const [, , annotationTransform, appearanceMatrix] = args;
      state = {
        transform: multiplyMatrices(Array.from(annotationTransform), appearanceMatrix),
        textRenderingMode: 0
      };
    } else if (fn === ops.setTextRenderingMode) state = {
      ...state,
      textRenderingMode: args[0]
    };
    else if (fn === ops.beginGroup) softMaskGroupFlags.push(Boolean(args[0]?.smask));
    else if (fn === ops.endGroup) softMaskGroupFlags.pop();
    else if (fn === ops.beginMarkedContent) contentVisibilityFlags.push(true);
    else if (fn === ops.beginMarkedContentProps) {
      const [tag, properties] = args;
      contentVisibilityFlags.push(tag !== "OC" || optionalContentConfig.isVisible(properties));
    } else if (fn === ops.endMarkedContent) contentVisibilityFlags.pop();
    if (softMaskGroupFlags.includes(true)) continue;
    yield {
      fn,
      args,
      ...state,
      isVisible: !contentVisibilityFlags.includes(false)
    };
  }
}
function getUnitSquareBounds(transform) {
  const [a, b, c, d, e, f] = transform;
  const xs = [
    e,
    a + e,
    c + e,
    a + c + e
  ];
  const ys = [
    f,
    b + f,
    d + f,
    b + d + f
  ];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY
  };
}
function multiplyMatrices(outer, inner) {
  const [a, b, c, d, e, f] = outer;
  const [a2, b2, c2, d2, e2, f2] = Array.from(inner);
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f
  ];
}
var PNG_SIGNATURE = [
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10
];
var crcTable;
async function encodePNG(rgba, width, height) {
  const rowLength = width * 4;
  const scanlines = new Uint8Array((rowLength + 1) * height);
  for (let y = 0; y < height; y++) scanlines.set(rgba.subarray(y * rowLength, (y + 1) * rowLength), y * (rowLength + 1) + 1);
  const header = /* @__PURE__ */ new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const chunks = [
    createChunk("IHDR", header),
    createChunk("IDAT", await deflate(scanlines)),
    createChunk("IEND", /* @__PURE__ */ new Uint8Array(0))
  ];
  const png = new Uint8Array(PNG_SIGNATURE.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  png.set(PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}
async function deflate(data) {
  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const [compressed] = await Promise.all([
    new Response(stream.readable).arrayBuffer(),
    writer.write(data),
    writer.close()
  ]);
  return new Uint8Array(compressed);
}
function createChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}
function crc32(bytes) {
  crcTable ??= createCRCTable();
  let crc = 4294967295;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
function createCRCTable() {
  const table = /* @__PURE__ */ new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let crc = n;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 3988292384 ^ crc >>> 1 : crc >>> 1;
    table[n] = crc;
  }
  return table;
}
function registerImageDecoders() {
  globalThis[/* @__PURE__ */ Symbol.for("unpdf.loadImageDecoder")] ??= async (fileName) => {
    const { loadDecoder } = await import("./pdfjs-decoders-KCLICLD3.mjs");
    return await loadDecoder(fileName);
  };
}
async function extractImages(data, pageNumber, options = {}) {
  registerImageDecoders();
  return await withDocument(data, async (pdf) => {
    if (pageNumber < 1 || pageNumber > pdf.numPages) throw new Error(`Invalid page number. Must be between 1 and ${pdf.numPages}.`);
    const page = await pdf.getPage(pageNumber);
    const [operatorList, optionalContentConfig] = await Promise.all([page.getOperatorList(), pdf.getOptionalContentConfig()]);
    const { ImageKind, OPS } = await getResolvedPDFJS();
    const images = [];
    for (const { fn, args, transform, isVisible } of walkOperatorList(operatorList, OPS, optionalContentConfig)) {
      if (!isVisible) continue;
      let key = null;
      let image;
      if (fn === OPS.paintImageXObject) {
        key = args[0];
        image = await getPageObject(page, key);
      } else if (fn === OPS.paintInlineImageXObject) image = args[0];
      else if (fn === OPS.paintImageMaskXObject) {
        key = args[0].data;
        image = await getPageObject(page, key);
      } else continue;
      if (!image) continue;
      const pixels = toRGBA(image, fn === OPS.paintImageMaskXObject, ImageKind);
      if (!pixels) continue;
      images.push({
        data: options.format === "png" ? await encodePNG(pixels, image.width, image.height) : pixels,
        width: image.width,
        height: image.height,
        key,
        bounds: getUnitSquareBounds(transform)
      });
    }
    return images;
  }, {
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false
  });
}
async function renderPageAsImage(data, pageNumber, options = {}) {
  registerImageDecoders();
  await prepareCanvasEnvironment(options.canvasImport);
  return await withDocument(data, async (pdf) => {
    if (pageNumber < 1 || pageNumber > pdf.numPages) throw new Error(`Invalid page number. Must be between 1 and ${pdf.numPages}.`);
    const page = await pdf.getPage(pageNumber);
    const defaultViewport = page.getViewport({ scale: 1 });
    let scale = options.scale ?? 1;
    if (options.width !== void 0) scale = options.width / defaultViewport.width;
    else if (options.height !== void 0) scale = options.height / defaultViewport.height;
    const viewport = page.getViewport({ scale });
    const canvasFactory = pdf.canvasFactory;
    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
    try {
      const { canvas } = canvasAndContext;
      await page.render({
        canvas,
        viewport
      }).promise;
      const { format = "png", quality } = options;
      const mimeType = `image/${format}`;
      if (options.toDataURL) {
        const dataURL = canvas.toDataURL(mimeType, quality);
        assertEncodedType(dataURL.slice(5, dataURL.indexOf(";")), mimeType);
        return dataURL;
      }
      if ("encode" in canvas) {
        const buffer = format === "png" ? await canvas.encode(format) : await canvas.encode(format, quality === void 0 ? void 0 : quality * 100);
        return new Uint8Array(buffer);
      }
      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, mimeType, quality);
      });
      if (!blob) throw new Error(`Failed to encode canvas as ${mimeType}.`);
      assertEncodedType(blob.type, mimeType);
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      canvasFactory.destroy(canvasAndContext);
    }
  });
}
function getPageObject(page, objectId) {
  const objects = objectId.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => objects.get(objectId, resolve));
}
function toRGBA(image, isMask, imageKind) {
  const { data, width, height, kind } = image;
  if (!data) return;
  const rgba = new Uint8Array(width * height * 4);
  if (kind === imageKind.RGBA_32BPP) {
    rgba.set(data.subarray(0, rgba.length));
    return rgba;
  }
  if (kind === imageKind.RGB_24BPP) {
    for (let source = 0, target = 0; target < rgba.length; source += 3, target += 4) {
      rgba[target] = data[source];
      rgba[target + 1] = data[source + 1];
      rgba[target + 2] = data[source + 2];
      rgba[target + 3] = 255;
    }
    return rgba;
  }
  if (!isMask && kind !== imageKind.GRAYSCALE_1BPP) return;
  const bytesPerRow = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const bit = data[y * bytesPerRow + (x >> 3)] >> 7 - (x & 7) & 1;
    const target = (y * width + x) * 4;
    if (isMask) rgba[target + 3] = bit === 0 ? 255 : 0;
    else {
      rgba.fill(bit === 0 ? 0 : 255, target, target + 3);
      rgba[target + 3] = 255;
    }
  }
  return rgba;
}
async function prepareCanvasEnvironment(canvasImport) {
  const isWorkerd = globalThis.navigator?.userAgent === "Cloudflare-Workers";
  if (isNode && !isWorkerd) {
    if (!canvasImport) throw new Error('Parameter "canvasImport" is required in Node.js environment.');
    await resolveCanvasModule(canvasImport);
    injectCanvasConstructors();
    return;
  }
  if (typeof document === "undefined") throw new Error("Unsupported environment for canvas creation.");
}
function assertEncodedType(encodedType, mimeType) {
  if (encodedType !== mimeType) throw new Error(`This environment can't encode ${mimeType}, only ${encodedType}.`);
}
var WHITESPACE_PATTERN = /\s/g;
async function inspectPages(data) {
  registerImageDecoders();
  return await withDocument(data, async (pdf) => {
    const { OPS } = await getResolvedPDFJS();
    const optionalContentConfig = await pdf.getOptionalContentConfig();
    const shouldReleasePages = !isPDFDocumentProxy(data);
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) pages.push(await inspectPage(pdf, pageNumber, OPS, optionalContentConfig, shouldReleasePages));
    return {
      totalPages: pdf.numPages,
      pages
    };
  });
}
async function inspectPage(document2, pageNumber, ops, optionalContentConfig, shouldReleasePage) {
  const page = await document2.getPage(pageNumber);
  const [textContent, operatorList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  const textLength = textContent.items.reduce((sum, item) => sum + ("str" in item ? countCharacters(item.str) : 0), 0);
  let invisibleTextLength = 0;
  const imageBounds = [];
  for (const { fn, args, transform, textRenderingMode, isVisible } of walkOperatorList(operatorList, ops, optionalContentConfig)) if (fn === ops.showText && (!isVisible || textRenderingMode === 3 || textRenderingMode === 7)) {
    for (const glyph of args[0]) if (typeof glyph === "object" && glyph?.unicode) invisibleTextLength += countCharacters(glyph.unicode);
  } else if (isVisible && (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject || fn === ops.paintImageMaskXObject)) imageBounds.push(getUnitSquareBounds(transform));
  if (shouldReleasePage) page.cleanup();
  return {
    textLength,
    invisibleTextLength,
    imageCount: imageBounds.length,
    imageCoverage: getCoverage(imageBounds, page.view)
  };
}
function countCharacters(text) {
  return Array.from(text.replace(WHITESPACE_PATTERN, "")).length;
}
function getCoverage(boxes, view) {
  const [viewX0, viewY0, viewX1, viewY1] = view;
  const viewArea = (viewX1 - viewX0) * (viewY1 - viewY0);
  if (viewArea <= 0) return 0;
  const clippedBoxes = boxes.map((box) => ({
    x0: Math.max(box.x, viewX0),
    x1: Math.min(box.x + box.width, viewX1),
    y0: Math.max(box.y, viewY0),
    y1: Math.min(box.y + box.height, viewY1)
  })).filter((box) => box.x0 < box.x1 && box.y0 < box.y1);
  const edges = [...new Set(clippedBoxes.flatMap((box) => [box.x0, box.x1]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const left = edges[i];
    const right = edges[i + 1];
    const spans = clippedBoxes.filter((box) => box.x0 <= left && box.x1 >= right).sort((a, b) => a.y0 - b.y0);
    let coveredHeight = 0;
    let coveredTop = -Infinity;
    for (const { y0, y1 } of spans) {
      const start = Math.max(y0, coveredTop);
      if (y1 > start) {
        coveredHeight += y1 - start;
        coveredTop = y1;
      }
    }
    area += coveredHeight * (right - left);
  }
  return area / viewArea;
}
async function extractLinks(data) {
  return await withDocument(data, async (pdf) => {
    const links = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) links.push(await getPageLinks(pdf, pageNumber));
    return {
      totalPages: pdf.numPages,
      links
    };
  });
}
async function getPageLinks(document2, pageNumber) {
  const annotations = await (await document2.getPage(pageNumber)).getAnnotations();
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
async function getMeta(data, options = {}) {
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
      metadata: metadata ?? null
    };
  });
}
function parseISODateString(isoDateString) {
  const parsedDate = Date.parse(isoDateString);
  return Number.isNaN(parsedDate) ? null : new Date(parsedDate);
}
async function extractTextItems(data) {
  return await withDocument(data, async (pdf) => {
    const items = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) items.push(await getPageTextItems(pdf, pageNumber));
    return {
      totalPages: pdf.numPages,
      items
    };
  });
}
async function getPageTextItems(document2, pageNumber) {
  const content = await (await document2.getPage(pageNumber)).getTextContent();
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
async function extractText(data, options = {}) {
  const { mergePages = false } = options;
  return await withDocument(data, async (pdf) => {
    const texts = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) texts.push(await getPageText(pdf, pageNumber));
    return {
      totalPages: pdf.numPages,
      text: mergePages ? normalizeMergedText(texts) : texts
    };
  });
}
async function getPageText(document2, pageNumber) {
  return (await (await document2.getPage(pageNumber)).getTextContent()).items.filter((item) => item.str != null).map((item) => item.str + (item.hasEOL ? "\n" : "")).join("");
}
function normalizeMergedText(texts) {
  return texts.join("\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
}
export {
  definePDFJSModule,
  extractImages,
  extractLinks,
  extractText,
  extractTextItems,
  getDocumentProxy,
  getMeta,
  getResolvedPDFJS,
  inspectPages,
  registerImageDecoders,
  renderPageAsImage
};
//# sourceMappingURL=dist-EX36KJTD.mjs.map