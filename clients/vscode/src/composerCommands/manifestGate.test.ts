import { describe, expect, it } from "vitest";
import { manifestHasErrors, parseManifest } from "@seanhogg/builderforce-webcontainers-core/manifest";
import { isManifestPath, manifestRefusal } from "./manifestGate";

const VALID = JSON.stringify({
  version: 1,
  name: "demo",
  services: { web: { runtime: "node", command: "node server.js", port: 3000, role: "frontend", readiness: { http: "/" } } },
});
const INVALID = JSON.stringify({ version: 1, services: { web: { runtime: "bogus", port: "x" }, "Bad Id": {} } });

describe("manifestRefusal", () => {
  it("lets a valid manifest through", () => {
    expect(manifestRefusal(".builderforce/builderforce.json", VALID)).toBeNull();
  });

  it("names every error the runtime's parser reports", () => {
    const errors = parseManifest(INVALID).issues.filter((issue) => issue.severity === "error");
    expect(manifestHasErrors(parseManifest(INVALID).issues)).toBe(true);
    const refusal = manifestRefusal(".builderforce/builderforce.json", INVALID)!;
    expect(refusal).toMatch(/^Refused: \.builderforce\/builderforce\.json is not a valid app manifest:/);
    expect(refusal.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(errors.length);
    expect(errors.length).toBeGreaterThan(1);
  });

  it("refuses text that is not JSON", () => {
    expect(manifestRefusal("builderforce.json", "{ nope")).toContain("not valid JSON");
  });

  it("does not refuse the legacy unversioned format: the host reads it itself", () => {
    expect(manifestRefusal("builderforce.json", JSON.stringify({ services: {} }))).toBeNull();
  });
});

describe("isManifestPath", () => {
  it("matches the canonical path and the legacy root files, in any folder", () => {
    expect(isManifestPath(".builderforce/builderforce.json")).toBe(true);
    expect(isManifestPath("apps/shop/.builderforce/builderforce.json")).toBe(true);
    expect(isManifestPath("builderforce.json")).toBe(true);
    expect(isManifestPath("apps\\shop\\builderforce.json")).toBe(true);
  });

  it("rejects look-alikes", () => {
    expect(isManifestPath("src/notbuilderforce.json")).toBe(false);
    expect(isManifestPath("package.json")).toBe(false);
  });
});
