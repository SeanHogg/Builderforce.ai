// ../../.pipeline-validation/node_modules/unpdf/dist/pdfjs-loader.mjs
function createDecoderLoader(e) {
  return async (t2) => {
    if (!Object.hasOwn(e, t2)) throw Error(`No bundled decoder for ${t2}`);
    let { default: n } = await e[t2]();
    return n;
  };
}

// ../../.pipeline-validation/node_modules/unpdf/dist/pdfjs-decoders.mjs
var t = createDecoderLoader({ "jbig2.wasm": () => import("./pdfjs-jbig2-MRRGN7QF.mjs"), "jbig2_nowasm_fallback.js": () => import("./pdfjs-jbig2_nowasm_fallback-K6D7WPDX.mjs"), "openjpeg.wasm": () => import("./pdfjs-openjpeg-44ARGNLX.mjs"), "openjpeg_nowasm_fallback.js": () => import("./pdfjs-openjpeg_nowasm_fallback-SMPIGGDT.mjs") });
export {
  t as loadDecoder
};
//# sourceMappingURL=pdfjs-decoders-KCLICLD3.mjs.map