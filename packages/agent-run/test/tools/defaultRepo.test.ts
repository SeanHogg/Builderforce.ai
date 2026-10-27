import { describe, expect, it } from "vitest";
import { pathsInText, resolveDefaultRepo } from "@builderforce/agent-tools";

/**
 * Ported VERBATIM from `packages/agent-tools/src/defaultRepo.test.ts` (PRD 35 WS2f),
 * import retargeted to the `@builderforce/agent-tools` source package. Assertions unchanged.
 * PRD 35 E3: which checkout a run works in when the open folder CONTAINS checkouts.
 */
describe("resolveDefaultRepo", () => {
  const candidates = [
    { name: "Builderforce.ai", origin: { owner: "seanhogg", repo: "Builderforce.ai" } },
    { name: "builderforce-memory", origin: { owner: "seanhogg", repo: "builderforce-memory" } },
  ];

  it("an explicit repo wins", () => {
    expect(resolveDefaultRepo({ candidates, explicit: "builderforce-memory", paths: ["Builderforce.ai/x.md"] })).toBe("builderforce-memory");
  });

  it("refuses an explicit repo that would leave the workspace, and falls through", () => {
    expect(resolveDefaultRepo({ candidates: ["app"], explicit: "../etc" })).toBe("app");
  });

  it("a path in the request picks its checkout", () => {
    expect(resolveDefaultRepo({ candidates, paths: pathsInText("update Builderforce.ai/docs/specs/35-prd.md now") })).toBe("Builderforce.ai");
  });

  it("matches a path's checkout case-insensitively and answers with the folder's own name", () => {
    expect(resolveDefaultRepo({ candidates, paths: ["builderforce.ai/README.md"] })).toBe("Builderforce.ai");
  });

  it("the project's repository picks the checkout whose origin it is", () => {
    expect(resolveDefaultRepo({ candidates, projectRepos: [{ owner: "SeanHogg", repo: "builderforce-memory" }] })).toBe("builderforce-memory");
  });

  it("prefers the project's DEFAULT repository when several match", () => {
    const repos = [
      { owner: "seanhogg", repo: "Builderforce.ai" },
      { owner: "seanhogg", repo: "builderforce-memory", isDefault: true },
    ];
    expect(resolveDefaultRepo({ candidates, projectRepos: repos })).toBe("builderforce-memory");
  });

  it("a single checkout is the default", () => {
    expect(resolveDefaultRepo({ candidates: ["app"] })).toBe("app");
  });

  it("is undefined when nothing decides between several checkouts", () => {
    expect(resolveDefaultRepo({ candidates })).toBeUndefined();
    // Paths into two different checkouts decide nothing either.
    expect(resolveDefaultRepo({ candidates, paths: ["Builderforce.ai/a.md", "builderforce-memory/b.md"] })).toBeUndefined();
    expect(resolveDefaultRepo({ candidates: [] })).toBeUndefined();
  });
});

describe("pathsInText", () => {
  it("finds repo-relative paths and ignores bare words", () => {
    expect(pathsInText("fix `app/src/x.ts`, then docs/README.md. Also README.md")).toEqual(["app/src/x.ts", "docs/README.md"]);
  });

  it("skips traversal and empty input", () => {
    expect(pathsInText("../etc/passwd")).toEqual([]);
    expect(pathsInText(undefined)).toEqual([]);
  });
});
