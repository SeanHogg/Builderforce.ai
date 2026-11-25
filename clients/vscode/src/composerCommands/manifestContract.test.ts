/**
 * The contract between the manifests this extension WRITES and the parser the runtime READS
 * them with (`@seanhogg/builderforce-webcontainers-core/manifest`): every starter kit's
 * `builderforce.json`, and every manifest `/manifest init` / `/launch` detect, parse and
 * validate with zero issues. Asserts zero issues only — never a manifest's shape.
 */
import { describe, expect, it } from "vitest";
import { parseManifest, validateManifest } from "@seanhogg/builderforce-webcontainers-core/manifest";
import { composeKit, NAMED_KITS } from "@builderforce/ide-templates/kits";
import {
  LEGACY_MANIFEST_PATHS, MANIFEST_DIR, MANIFEST_FILE_NAME, MANIFEST_PATH as KIT_MANIFEST_PATH, MANIFEST_READ_PATHS,
} from "@builderforce/app-detect/manifest";
import { emitStaticSiteManifest } from "@builderforce/app-detect";
import { detectWorkspaceManifest } from "./detectManifest";
import { LEGACY_MANIFEST_FILES, MANIFEST_FILE, MANIFEST_PATH, MANIFEST_READ_ORDER, WORKSPACE_DIR } from "./manifestLocation";

/**
 * ONE place for the manifest: the pure packages (app-detect, the starter kits) state it once
 * because the runtime's `/manifest` module is Node-only; this pins that statement to the
 * runtime's, so the kits write and the detectors read exactly where the launcher looks.
 */
describe("where the manifest lives: app-detect agrees with the runtime", () => {
  it("names the same file, folder, canonical path and legacy fallbacks", () => {
    expect(MANIFEST_FILE_NAME).toBe(MANIFEST_FILE);
    expect(MANIFEST_DIR).toBe(WORKSPACE_DIR);
    expect(KIT_MANIFEST_PATH).toBe(MANIFEST_PATH);
    expect(MANIFEST_PATH).toBe(".builderforce/builderforce.json");
    expect([...LEGACY_MANIFEST_PATHS]).toEqual([...LEGACY_MANIFEST_FILES]);
    expect([...MANIFEST_READ_PATHS]).toEqual([...MANIFEST_READ_ORDER]);
  });

  it.each([...NAMED_KITS])("starter kit %s writes its manifest at .builderforce/builderforce.json, never at the root", (kitId) => {
    const { files } = composeKit(kitId);
    expect(files[MANIFEST_PATH]).toBeDefined();
    for (const legacy of LEGACY_MANIFEST_FILES) expect(files[legacy]).toBeUndefined();
  });
});

/** Parse with the runtime's ONE reader, validate again explicitly; every issue found. */
function runtimeIssues(text: string) {
  const parsed = parseManifest(text);
  return { manifest: parsed.manifest, issues: [...parsed.issues, ...(parsed.manifest ? validateManifest(parsed.manifest) : [])] };
}

const pkg = (body: Record<string, unknown>) => JSON.stringify(body);

/** A root Vite app (package.json + vite.config.js proxying /api to a local backend) and its backend in api/. */
const viteApp = {
  "package.json": pkg({ name: "web", scripts: { dev: "vite" }, dependencies: { react: "19" }, devDependencies: { vite: "6" } }),
  "vite.config.js": "import { defineConfig } from 'vite';\nexport default defineConfig({ server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } } });\n",
};

/** The shapes that DO get an ingress: each must emit one, and the runtime must read it. */
const INGRESS_FIXTURES: Record<string, Record<string, string>> = {
  "vite + fastapi under /api": {
    ...viteApp,
    "api/requirements.txt": "fastapi\nuvicorn\n",
    "api/main.py": "from fastapi import FastAPI\napp = FastAPI()\n@app.get(\"/api/items\")\ndef items(): ...\n",
  },
};

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
  ...INGRESS_FIXTURES,
};

describe("manifests the extension writes parse cleanly in the runtime", () => {
  it.each([...NAMED_KITS])("starter kit %s: builderforce.json parses and validates with zero issues", (kitId) => {
    const kit = composeKit(kitId);
    expect(kit.issues).toEqual([]);
    const text = kit.files[MANIFEST_PATH];
    expect(text).toBeDefined();
    const { manifest, issues } = runtimeIssues(text!);
    expect(manifest).not.toBeNull();
    expect(issues).toEqual([]);
  });

  it.each(Object.keys(INGRESS_FIXTURES))("detected app %s: emits the /api ingress, and the runtime reads it with zero issues", (name) => {
    const detected = detectWorkspaceManifest(new Map(Object.entries(INGRESS_FIXTURES[name]!)));
    const { manifest, issues } = runtimeIssues(detected.text);
    expect(issues).toEqual([]);
    expect(manifest?.ingress?.routes.map((route) => route.path)).toEqual(["/api", "/"]);
  });

  it.each(Object.keys(DETECTION_FIXTURES))("detected app %s: detect → emitManifest → parse + validate with zero issues", (name) => {
    const detected = detectWorkspaceManifest(new Map(Object.entries(DETECTION_FIXTURES[name]!)));
    const { manifest, issues } = runtimeIssues(detected.text);
    expect(manifest).not.toBeNull();
    expect(issues).toEqual([]);
  });

  it("the static-site manifest a page launch runs: parse + validate with zero issues", () => {
    const { manifest, issues } = runtimeIssues(emitStaticSiteManifest("mockup").text);
    expect(manifest).not.toBeNull();
    expect(issues).toEqual([]);
  });

  it.each([...NAMED_KITS])("starter kit %s, re-detected from its own files: zero issues", (kitId) => {
    const files = { ...composeKit(kitId).files };
    delete files[MANIFEST_PATH]; // detected from the code, as `/launch` does in a folder with no manifest
    const { manifest, issues } = runtimeIssues(detectWorkspaceManifest(new Map(Object.entries(files))).text);
    expect(manifest).not.toBeNull();
    expect(issues).toEqual([]);
  });
});
