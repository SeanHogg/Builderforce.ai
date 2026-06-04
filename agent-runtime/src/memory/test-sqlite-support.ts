import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const hasNodeSqliteSupport = (() => {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();
