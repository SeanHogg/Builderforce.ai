"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/pageEngines/bfiLoader.ts
var bfiLoader_exports = {};
__export(bfiLoader_exports, {
  bfiWebLoader: () => bfiWebLoader,
  loadBfiWeb: () => loadBfiWeb,
  resetBfiWebForTests: () => resetBfiWebForTests
});
module.exports = __toCommonJS(bfiLoader_exports);
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
    const module2 = await importer();
    await module2.default({ module_or_path: wasmUrl });
    return { BfiEngine: module2.BfiEngine };
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  bfiWebLoader,
  loadBfiWeb,
  resetBfiWebForTests
});
//# sourceMappingURL=bfi.cjs.map