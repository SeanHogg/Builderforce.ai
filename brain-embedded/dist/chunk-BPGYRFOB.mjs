// ../../.pipeline-validation/node_modules/unpdf/dist/pdfjs-rolldown-runtime.mjs
var e = /* @__PURE__ */ (() => {
  for (var e2 = /* @__PURE__ */ new Uint8Array(128), t = 0; t < 64; t++) e2[t < 26 ? t + 65 : t < 52 ? t + 71 : t < 62 ? t - 4 : t * 4 - 205] = t;
  return (t2) => {
    for (var n = t2.length, r = new Uint8Array((n - (t2[n - 1] == `=`) - (t2[n - 2] == `=`)) * 3 / 4 | 0), i = 0, a = 0; i < n; ) {
      var o = e2[t2.charCodeAt(i++)], s = e2[t2.charCodeAt(i++)], c = e2[t2.charCodeAt(i++)], l = e2[t2.charCodeAt(i++)];
      r[a++] = o << 2 | s >> 4, r[a++] = s << 4 | c >> 2, r[a++] = c << 6 | l;
    }
    return r;
  };
})();

export {
  e
};
//# sourceMappingURL=chunk-BPGYRFOB.mjs.map