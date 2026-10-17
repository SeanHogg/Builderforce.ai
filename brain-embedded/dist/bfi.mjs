// src/pageEngines/bfiLoader.ts
var importBfiWeb = () => import("@seanhogg/bfi-web");
var loaded;
var loadedFrom;
function loadBfiWeb(wasmUrl, importer = importBfiWeb) {
  const url = String(wasmUrl);
  if (loaded) {
    if (loadedFrom !== url) console.warn(`bfi-web already initialized from ${loadedFrom}; ignoring ${url}`);
    return loaded;
  }
  loadedFrom = url;
  const attempt = (async () => {
    const module = await importer();
    await module.default({ module_or_path: wasmUrl });
    return { BfiEngine: module.BfiEngine };
  })();
  loaded = attempt;
  attempt.catch(() => {
    if (loaded === attempt) {
      loaded = void 0;
      loadedFrom = void 0;
    }
  });
  return attempt;
}
function bfiWebLoader(wasmUrl) {
  return async () => loadBfiWeb(typeof wasmUrl === "function" ? await wasmUrl() : wasmUrl);
}
function resetBfiWebForTests() {
  loaded = void 0;
  loadedFrom = void 0;
}
export {
  bfiWebLoader,
  loadBfiWeb,
  resetBfiWebForTests
};
//# sourceMappingURL=bfi.mjs.map