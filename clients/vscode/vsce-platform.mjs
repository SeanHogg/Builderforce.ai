import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const operation = process.argv[2];
if (operation !== "package" && operation !== "publish") {
  throw new Error("Expected package or publish.");
}

const isMusl = process.platform === "linux"
  && !process.report?.getReport?.().header?.glibcVersionRuntime;
const os = process.platform === "win32"
  ? "win32"
  : process.platform === "darwin"
    ? "darwin"
    : isMusl ? "alpine" : "linux";
const architecture = process.arch === "arm64" ? "arm64" : "x64";
const target = `${os}-${architecture}`;
const vsceCli = createRequire(import.meta.url).resolve("@vscode/vsce/vsce");
const forwardedArgs = process.argv.slice(3);
if (operation === "package" && !forwardedArgs.some((arg) => arg === "--out" || arg === "-o")) {
  const manifest = createRequire(import.meta.url)("./package.json");
  forwardedArgs.push("--out", `${manifest.name}-${manifest.version}.vsix`);
}
const result = spawnSync(
  process.execPath,
  [vsceCli, operation, "--no-dependencies", "--target", target, ...forwardedArgs],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
