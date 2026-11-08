import { describe, expect, it } from "vitest";
import { resolveExternalTarget } from "./externalUrl";

const WEB = "https://builderforce.ai";

describe("resolveExternalTarget", () => {
  it("opens routes on the web app", () => {
    expect(resolveExternalTarget("/pricing?x=1", WEB)).toBe("https://builderforce.ai/pricing?x=1");
  });
  it("opens absolute URLs on the web origin and the hosted checkout origin", () => {
    expect(resolveExternalTarget("https://builderforce.ai/a", WEB)).toBe("https://builderforce.ai/a");
    expect(resolveExternalTarget("https://checkout.stripe.com/pay/cs_1", WEB)).toBe("https://checkout.stripe.com/pay/cs_1");
  });
  it("refuses foreign origins and tricks", () => {
    expect(resolveExternalTarget("https://evil.com", WEB)).toBeNull();
    expect(resolveExternalTarget("//evil.com", WEB)).toBeNull();
    expect(resolveExternalTarget("@evil.com", WEB)).toBeNull();
    expect(resolveExternalTarget("/@evil.com", WEB)).toBe("https://builderforce.ai/@evil.com");
    expect(resolveExternalTarget("/\evil.com", WEB)).toBeNull();
    expect(resolveExternalTarget("https://builderforce.ai@evil.com/", WEB)).toBeNull();
    expect(resolveExternalTarget("https://checkout.stripe.com.evil.com/", WEB)).toBeNull();
    expect(resolveExternalTarget("http://checkout.stripe.com/", WEB)).toBeNull();
    expect(resolveExternalTarget("file:///etc/passwd", WEB)).toBeNull();
    expect(resolveExternalTarget("javascript:alert(1)", WEB)).toBeNull();
  });
});
