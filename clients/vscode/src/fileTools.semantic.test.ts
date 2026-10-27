import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveLocalSemantic } = vi.hoisted(() => ({
  resolveLocalSemantic: vi.fn(async () => ({
    search: async () => ({ ok: false }),
    repoMap: async () => ({ ok: true, map: "" }),
  })),
}));
vi.mock("./localSemantic", () => ({ resolveLocalSemantic }));

import { TOOL_DEFS, callUsesSemantic } from "./fileTools";

describe("the semantic backing is resolved only for a call that can use it", () => {
  it("callUsesSemantic: the semantic tools, and shell output only while C8 compresses it", () => {
    expect(callUsesSemantic(["repo.semantic"], false)).toBe(true);
    expect(callUsesSemantic(["repo.read", "repo.compress"], false)).toBe(true);
    expect(callUsesSemantic(["repo.read"], true)).toBe(false);
    expect(callUsesSemantic(["shell"], false)).toBe(false);
    expect(callUsesSemantic(["shell"], true)).toBe(true);
  });

  describe("on a real call", () => {
    let root: string;
    beforeEach(async () => {
      resolveLocalSemantic.mockClear();
      root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-semantic-"));
      await fs.writeFile(path.join(root, "a.ts"), "export const a = 1;\n");
    });
    afterEach(async () => {
      await fs.rm(root, { recursive: true, force: true });
    });

    it("read_file never probes Desktop; repo_map does", async () => {
      const def = (name: string) => TOOL_DEFS.find((d) => d.name === name)!;
      await def("read_file").execute({ path: "a.ts" }, root);
      expect(resolveLocalSemantic).not.toHaveBeenCalled();
      await def("repo_map").execute({}, root);
      expect(resolveLocalSemantic).toHaveBeenCalledWith(root);
    });
  });
});
