import { ASSET_MAX_BYTES, ASSET_MAX_VIDEO_BYTES } from "@builderforce/asset-limits";
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { uploadRefusal } from "./attachmentIngress";

describe("uploadRefusal", () => {
  it("refuses every cloud upload in Local only, however small", () => {
    expect(uploadRefusal({ mime: "application/pdf", size: 1 }, "local-only")).toEqual({ reason: "local-only" });
  });

  it.each([
    ["image/png", ASSET_MAX_BYTES],
    ["video/webm", ASSET_MAX_VIDEO_BYTES],
  ])("enforces the platform ceiling for %s", (mime, maxBytes) => {
    expect(uploadRefusal({ mime, size: maxBytes + 1 }, "hybrid")).toEqual({ reason: "too-large", maxBytes });
    expect(uploadRefusal({ mime, size: maxBytes }, "hybrid")).toBeNull();
  });
});
