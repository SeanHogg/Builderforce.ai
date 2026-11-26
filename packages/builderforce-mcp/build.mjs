import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const manifest = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));

await build({
  entryPoints: Object.values(manifest.exports),
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  outdir: "dist",
  external: Object.keys(manifest.dependencies),
});
