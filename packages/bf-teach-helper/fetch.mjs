/**
 * Downloads the Teach helper binaries into `bin/<tag>/` from the newest
 * SeanHogg/builderforce-inference release that carries them (needs the `gh` CLI, signed in).
 * Asset names map to platform tags through targets.json, the same table esbuild.mjs and the
 * extension's loader use. Usage: node packages/bf-teach-helper/fetch.mjs [--tag vX]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const table = JSON.parse(fs.readFileSync(path.join(here, "targets.json"), "utf8"));
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const tagArg = process.argv.indexOf("--tag");
let tag = tagArg > 0 ? process.argv[tagArg + 1] : undefined;
if (!tag) {
  const releases = JSON.parse(gh(["api", `repos/${table.repository}/releases?per_page=30`]));
  const found = releases.find((r) => !r.draft && table.targets.every((t) => r.assets.some((a) => a.name === t.asset)));
  if (!found) {
    console.warn("[bf-teach-helper] no release carries every helper asset yet; nothing fetched (the feature will report unsupported).");
    process.exit(0);
  }
  tag = found.tag_name;
}

for (const t of table.targets) {
  const dir = path.join(here, "bin", t.tag);
  fs.mkdirSync(dir, { recursive: true });
  gh(["release", "download", tag, "--repo", table.repository, "--pattern", t.asset, "--dir", dir, "--clobber"]);
  fs.renameSync(path.join(dir, t.asset), path.join(dir, t.binary));
  console.log(`[bf-teach-helper] ${t.tag} <- ${tag}/${t.asset}`);
}
