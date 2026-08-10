import fs from "node:fs";
import path from "node:path";

// `tsc` mirrors declarations under `dist/plugin-sdk/agent-runtime/src/plugin-sdk/*`
// because the public SDK's type graph includes sibling workspace packages and the
// declaration build's `rootDir` is their shared parent directory.
//
// Our package export map points subpath `types` at `dist/plugin-sdk/<entry>.d.ts`, so we
// generate stable entry d.ts files that re-export the real declarations.
const entrypoints = ["index", "account-id"] as const;
for (const entry of entrypoints) {
  const out = path.join(process.cwd(), `dist/plugin-sdk/${entry}.d.ts`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // NodeNext: reference the runtime specifier with `.js`, TS will map it to `.d.ts`.
  fs.writeFileSync(
    out,
    `export * from "./agent-runtime/src/plugin-sdk/${entry}.js";\n`,
    "utf8",
  );
}
