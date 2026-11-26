import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { walkFiles } from "../../scripts/lib/hashTree.mjs";

/**
 * BUILD IDENTITY — a source hash + a build timestamp stamped into the artifact.
 *
 * `package.json`'s `version` names a RELEASE, not an ARTIFACT: `npm run package` will
 * emit a second `builderforce-ai-<same version>.vsix` over an earlier one, so two
 * installs can report the identical version while containing different code. On
 * 2026-07-25 that made a fixed bug read as unfixed — a user on an older `2026.7.104`
 * reported the exact failure a rebuilt `2026.7.104` had fixed, and the chat diagnostics
 * (`UI 2026.7.104`) could not distinguish them.
 *
 * The hash covers every source file that ends up in the shipped artifact — the extension
 * host, the webview, the localization bundles and the manifest (but never tests) and
 * the bundler script — so ANY change to what ships changes the id, whether or not the
 * version was bumped. Deterministic (path + content, sorted), so an unchanged tree
 * rebuilds to the same id and a report can be compared against a `git` checkout.
 */
export const BUILD_HASH_ROOTS = ["src", "webview/src", "l10n"];
const BUILD_HASH_FILES = ["package.json", "esbuild.mjs", "buildId.mjs"];
const BUILD_HASH_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css"]);

/** Tests never reach the artifact, so they must not change its identity — otherwise
 *  "same id ⇒ same shipped code" stops being true in the useful direction. A missing root
 *  (e.g. l10n) that this checkout does not have yields nothing. */
function collectHashInputs(dir, out) {
  const accept = (name) => !/\.(test|spec)\.[cm]?tsx?$/.test(name) && BUILD_HASH_EXTENSIONS.has(path.extname(name));
  for (const file of walkFiles(dir, { accept, includeSymlinks: true })) out.push(file);
  return out;
}

export function computeBuildId(here) {
  const files = [];
  for (const root of BUILD_HASH_ROOTS) collectHashInputs(path.join(here, root), files);
  for (const file of BUILD_HASH_FILES) {
    const full = path.join(here, file);
    if (fs.existsSync(full)) files.push(full);
  }
  const hash = crypto.createHash("sha256");
  for (const file of files.sort()) {
    hash.update(path.relative(here, file).split(path.sep).join("/"));
    hash.update("\u0000");
    hash.update(fs.readFileSync(file));
    hash.update("\u0000");
  }
  return hash.digest("hex").slice(0, 12);
}
