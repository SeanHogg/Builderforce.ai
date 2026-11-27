import { describe, expect, it } from "vitest";
import { unguardedDynamicImports } from "../../scripts/check-bundle-dynamic-imports.mjs";

describe("unguardedDynamicImports", () => {
  it("accepts a call behind an injected value, on one line or wrapped", () => {
    const src = [
      'const engine = opts.engine ??',
      '    (await dynamicImport("@seanhogg/builderforce-memory-engine"));',
      'const e2 = injected ?? (await dynamicImport("@seanhogg/builderforce-memory-engine"));',
      'const m = opts.memory || await dynamicImport("@seanhogg/builderforce-memory");',
    ].join("\n");
    expect(unguardedDynamicImports(src)).toEqual([]);
  });

  it("flags a bare call, with its line", () => {
    const src = ["const a = 1;", 'const engine = await dynamicImport("@seanhogg/builderforce-memory-engine");'].join("\n");
    expect(unguardedDynamicImports(src)).toEqual([{ module: "@seanhogg/builderforce-memory-engine", line: 2 }]);
  });

  it("ignores other modules (node builtins, fake-indexeddb)", () => {
    expect(unguardedDynamicImports('await dynamicImport("node:fs"); await dynamicImport("fake-indexeddb");')).toEqual([]);
  });
});
