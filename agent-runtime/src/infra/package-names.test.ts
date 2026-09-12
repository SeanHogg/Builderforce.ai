import { describe, expect, it } from "vitest";
import {
  CORE_PACKAGE_NAME,
  CORE_PACKAGE_NAMES,
  isCorePackageName,
  stripPackagePrefix,
} from "./package-names.js";

describe("package names", () => {
  it("names the published scoped package first", () => {
    expect(CORE_PACKAGE_NAME).toBe("@seanhogg/builderforce-agents");
    expect(CORE_PACKAGE_NAMES[0]).toBe(CORE_PACKAGE_NAME);
  });

  it("recognises the current and legacy package names only", () => {
    expect(isCorePackageName("@seanhogg/builderforce-agents")).toBe(true);
    expect(isCorePackageName("builderforce")).toBe(true);
    expect(isCorePackageName("builderforce-agents")).toBe(false);
    expect(isCorePackageName(null)).toBe(false);
  });

  it("strips a package prefix from a tag spec", () => {
    expect(stripPackagePrefix("@seanhogg/builderforce-agents@beta")).toBe("beta");
    expect(stripPackagePrefix("builderforce@1.2.3")).toBe("1.2.3");
    expect(stripPackagePrefix("latest")).toBe("latest");
  });
});
