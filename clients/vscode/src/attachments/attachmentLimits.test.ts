import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { UPLOAD_MAX_BYTES, UPLOAD_MAX_VIDEO_BYTES, uploadMaxBytes, uploadRefusal } from "./attachmentIngress";

/**
 * The editor refuses an over-large upload BEFORE encoding it, so its ceiling must be the
 * platform's. Read from the api source rather than imported: the api module is typed
 * against the Workers runtime, which this project does not compile.
 */
const STORE = path.resolve(__dirname, "../../../api/src/application/assets/tenantAssetStore.ts");

function apiConstant(source: string, name: string): number {
  const m = new RegExp(`export const ${name} = ([\\d\\s*]+);`).exec(source);
  if (!m) throw new Error(`${name} not found in tenantAssetStore.ts`);
  return m[1]!.split("*").reduce((n, f) => n * Number(f.trim()), 1);
}

describe("the upload ceiling mirrors the platform's", () => {
  const source = fs.readFileSync(STORE, "utf8");

  it("holds the same per-type limits as assetMaxBytes", () => {
    expect(UPLOAD_MAX_BYTES).toBe(apiConstant(source, "ASSET_MAX_BYTES"));
    expect(UPLOAD_MAX_VIDEO_BYTES).toBe(apiConstant(source, "ASSET_MAX_VIDEO_BYTES"));
    expect(source).toContain("type.startsWith('video/') ? ASSET_MAX_VIDEO_BYTES : ASSET_MAX_BYTES");
    expect(uploadMaxBytes("video/mp4")).toBe(UPLOAD_MAX_VIDEO_BYTES);
    expect(uploadMaxBytes("application/pdf")).toBe(UPLOAD_MAX_BYTES);
  });
});

describe("uploadRefusal", () => {
  it("refuses every cloud upload in Local only, however small", () => {
    expect(uploadRefusal({ mime: "application/pdf", size: 1 }, "local-only")).toEqual({ reason: "local-only" });
  });

  it("refuses a file over its type's ceiling and admits one at it", () => {
    expect(uploadRefusal({ mime: "image/png", size: UPLOAD_MAX_BYTES + 1 }, "hybrid")).toEqual({ reason: "too-large", maxBytes: UPLOAD_MAX_BYTES });
    expect(uploadRefusal({ mime: "image/png", size: UPLOAD_MAX_BYTES }, "hybrid")).toBeNull();
    expect(uploadRefusal({ mime: "video/webm", size: UPLOAD_MAX_BYTES + 1 }, "hybrid")).toBeNull();
  });
});
