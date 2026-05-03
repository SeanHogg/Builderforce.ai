import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { main } from "../src/cli";

describe("cli main()", () => {
  let logs: string[];
  let errs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logs = [];
    errs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((m: unknown) => {
      logs.push(String(m));
    });
    errSpy = vi.spyOn(console, "error").mockImplementation((m: unknown) => {
      errs.push(String(m));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("list_architectures prints the registered ids", async () => {
    const code = await main(["list_architectures"]);
    expect(code).toBe(0);
    expect(logs).toContain("ltx2-distilled");
  });

  it("returns non-zero with usage on missing command", async () => {
    const code = await main([]);
    expect(code).toBe(2);
    expect(errs.join("\n")).toMatch(/missing command/);
  });

  it("returns non-zero on unknown command", async () => {
    const code = await main(["frobnicate"]);
    expect(code).toBe(2);
    expect(errs.join("\n")).toMatch(/unknown command/);
  });

  it("returns non-zero when convert_weight is missing required args", async () => {
    const code = await main(["convert_weight"]);
    expect(code).toBe(2);
  });

  it("returns non-zero on invalid quantization choice", async () => {
    const code = await main([
      "convert_weight",
      "src",
      "--architecture",
      "ltx2-distilled",
      "--quantization",
      "bogus",
      "-o",
      "out",
    ]);
    expect(code).toBe(2);
    expect(errs.join("\n")).toMatch(/quantization/);
  });

  it("verify without bundle dir returns non-zero with usage", async () => {
    const code = await main(["verify"]);
    expect(code).toBe(2);
    expect(errs.join("\n")).toMatch(/<bundle-dir>/);
  });

  it("info without bundle dir returns non-zero with usage", async () => {
    const code = await main(["info"]);
    expect(code).toBe(2);
    expect(errs.join("\n")).toMatch(/<bundle-dir>/);
  });

  it("usage lists all subcommands", async () => {
    await main([]);
    const usage = errs.join("\n");
    for (const sub of ["list_architectures", "build_graphs", "convert_weight", "verify", "info"]) {
      expect(usage).toMatch(sub);
    }
  });

  it("build_graphs without architecture returns non-zero", async () => {
    const code = await main(["build_graphs"]);
    expect(code).toBe(2);
    expect(errs.join("\n")).toMatch(/architecture/);
  });

  it("build_graphs without output returns non-zero", async () => {
    const code = await main(["build_graphs", "--architecture", "mini-test"]);
    expect(code).toBe(2);
    expect(errs.join("\n")).toMatch(/output/);
  });
});
