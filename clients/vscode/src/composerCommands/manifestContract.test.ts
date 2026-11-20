/**
 * The contract between the manifests this extension WRITES and the parser the runtime READS
 * them with (`@seanhogg/builderforce-webcontainers-core/manifest`): every starter kit's
 * `builderforce.json`, and every manifest `/manifest init` / `/launch` detect, parse and
 * validate with zero issues. Asserts zero issues only — never a manifest's shape.
 */
import { describe, expect, it } from "vitest";
import { parseManifest, validateManifest } from "@seanhogg/builderforce-webcontainers-core/manifest";
import { composeKit, MANIFEST_FILE, NAMED_KITS } from "@builderforce/ide-templates/kits";
import { detectWorkspaceManifest } from "./detectManifest";

/** Parse with the runtime's ONE reader, validate again explicitly; every issue found. */
function runtimeIssues(text: string) {
  const parsed = parseManifest(text);
  return { manifest: parsed.manifest, issues: [...parsed.issues, ...(parsed.manifest ? validateManifest(parsed.manifest) : [])] };
}

const pkg = (body: Record<string, unknown>) => JSON.stringify(body);

/** The app shapes app-detect's detector tests cover, as whole folders. */
const DETECTION_FIXTURES: Record<string, Record<string, string>> = {
  "vite react": { "package.json": pkg({ name: "web", scripts: { dev: "vite" }, dependencies: { react: "18" } }) },
  "next.js": { "package.json": pkg({ name: "site", scripts: { dev: "next dev" }, dependencies: { next: "15", react: "19" } }) },
  "astro": { "package.json": pkg({ name: "docs", scripts: { dev: "astro dev" }, dependencies: { astro: "4" } }) },
  "express api": { "package.json": pkg({ name: "api", scripts: { dev: "node server.js" }, dependencies: { express: "4" } }) },
  "web + api monorepo": {
    "package.json": pkg({ name: "mono", private: true, workspaces: ["web", "api"] }),
    "web/package.json": pkg({ name: "web", scripts: { dev: "vite" }, dependencies: { react: "18" } }),
    "api/package.json": pkg({ name: "api", scripts: { dev: "node server.js" }, dependencies: { express: "4", pg: "8" } }),
    ".env.example": "DATABASE_URL=\nAPI_KEY=\n",
  },
  "compose with postgres and redis": {
    "compose.yaml": [
      "services:",
      "  api:",
      "    build: ./api",
      "    ports: [\"8000:8000\"]",
      "    depends_on: [db, cache]",
      "  db:",
      "    image: postgres:16-alpine",
      "  cache:",
      "    image: redis:7",
      "",
    ].join("\n"),
    "api/requirements.txt": "fastapi\nuvicorn\n",
    "api/main.py": "from fastapi import FastAPI\napp = FastAPI()\n",
  },
};

describe("manifests the extension writes parse cleanly in the runtime", () => {
  it.each([...NAMED_KITS])("starter kit %s: builderforce.json parses and validates with zero issues", (kitId) => {
    const kit = composeKit(kitId);
    expect(kit.issues).toEqual([]);
    const { manifest, issues } = runtimeIssues(kit.files[MANIFEST_FILE] ?? kit.manifestText);
    expect(manifest).not.toBeNull();
    expect(issues).toEqual([]);
  });

  it.each(Object.keys(DETECTION_FIXTURES))("detected app %s: detect → emitManifest → parse + validate with zero issues", (name) => {
    const detected = detectWorkspaceManifest(new Map(Object.entries(DETECTION_FIXTURES[name]!)));
    const { manifest, issues } = runtimeIssues(detected.text);
    expect(manifest).not.toBeNull();
    expect(issues).toEqual([]);
  });

  it.each([...NAMED_KITS])("starter kit %s, re-detected from its own files: zero issues", (kitId) => {
    const files = { ...composeKit(kitId).files };
    delete files[MANIFEST_FILE]; // detected from the code, as `/launch` does in a folder with no manifest
    const { manifest, issues } = runtimeIssues(detectWorkspaceManifest(new Map(Object.entries(files))).text);
    expect(manifest).not.toBeNull();
    expect(issues).toEqual([]);
  });
});
