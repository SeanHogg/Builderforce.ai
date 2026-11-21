import { describe, expect, it, vi } from "vitest";
import { writeFileTool } from "./core-tools.js";
import { writeAllowed, type WriteScopePaths } from "./writeScope.js";

const paths: WriteScopePaths = {
  root: "/ws",
  methodology: "/ws/.builderforce/methodology",
  logs: "/ws/.builderforce/logs",
  diagnostics: "/ws/.builderforce/diagnostics",
};

describe("writeAllowed", () => {
  it("refuses an analyst write outside the methodology folder and allows one inside it", () => {
    const scope = [{ key: "methodology" as const }];
    const refused = writeAllowed(scope, paths, "src/a.ts", "analyst");
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toContain("analyst");
    expect(writeAllowed(scope, paths, "methodology/prd.md", "analyst").allowed).toBe(true);
    expect(writeAllowed(scope, paths, ".builderforce/methodology/prd.md", "analyst").allowed).toBe(true);
  });

  it("lets the engineer write the workspace root", () => {
    expect(writeAllowed([{ key: "root" }], paths, "src/a.ts", "engineer").allowed).toBe(true);
  });

  it("allows every path when the persona has no methodology scope", () => {
    expect(writeAllowed(undefined, paths, "src/a.ts", "analyst").allowed).toBe(true);
  });

  it("refuses a path that leaves the workspace", () => {
    expect(writeAllowed([{ key: "root" }], paths, "../etc/passwd", "engineer").allowed).toBe(false);
  });

  it("keeps support inside methodology/support", () => {
    const scope = [{ key: "methodology" as const, sub: "support" }];
    expect(writeAllowed(scope, paths, "methodology/support/note.md", "support").allowed).toBe(true);
    expect(writeAllowed(scope, paths, "methodology/prd.md", "support").allowed).toBe(false);
  });
});

describe("write_file consults write scope before writing", () => {
  it("does not write when the scope refuses the path", async () => {
    const writeFile = vi.fn(async () => ({ ok: true }));
    const result = await writeFileTool.execute(
      { path: "src/a.ts", content: "export const n = 1;\n" },
      {
        caps: { repoWrite: { writeFile } },
        writeScope: {
          scope: [{ key: "methodology" }],
          paths,
          roleName: "analyst",
        },
      } as never,
    );
    expect(result.data).toMatchObject({ ok: false });
    expect(writeFile).not.toHaveBeenCalled();
  });
});
