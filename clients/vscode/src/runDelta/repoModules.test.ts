/**
 * repoModules.test.ts — a run's side FileFacts resolve in REPO space with the REPOSITORY's own aliases (PRD 41 §B3): a
 * repository nested in the knowledge folder reads its own tsconfig `paths` at its own root, and the side's `@lib/x`
 * import resolves to the repo-relative file — which the knowledge folder's aliases would not.
 */

import { describe, expect, it } from "vitest";
import { aliasesOf, parseConfigText } from "@builderforce/agent-tools/knowledge";
import { placeRepo } from "./repoPlacement";
import { repoModulesRoot } from "./repoModules";
import { sideFileFacts } from "./sideFileFacts";

const kroot = { rootId: "folder", title: "workspace" };

describe("repoModulesRoot", () => {
  it("the repository IS the knowledge folder: the folder's aliases serve (no own root)", () => {
    expect(repoModulesRoot(placeRepo("/w", ["/w"])!, "/w", kroot)).toBeUndefined();
  });

  it("a repository nested in the folder (or above it) has its own aliases root, at the repository", () => {
    expect(repoModulesRoot(placeRepo("/w/apps/api", ["/w"])!, "/w/apps/api", kroot)).toEqual({ rootId: "folder::repo:/w/apps/api", rootPath: "/w/apps/api", title: "workspace" });
    expect(repoModulesRoot(placeRepo("/w", ["/w/pkg"])!, "/w", kroot)?.rootPath).toBe("/w");
  });
});

describe("side FileFacts with a nested repository's own tsconfig paths", () => {
  // The nested repo's tsconfig, at ITS root: `@lib/*` → `lib/*` (repo-relative).
  const repoAliases = aliasesOf(new Map([["tsconfig.json", parseConfigText(JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] } } }))!]]));
  const files = [{ path: "src/a.ts", hash: "h-a", text: "import { x } from '@lib/x';\nexport const a = x;\n" }];
  const listing = new Set(["src/a.ts", "lib/x.ts"]);

  it("resolves `@lib/x` to the repo-relative `lib/x.ts` with the repository's aliases", async () => {
    const facts = await sideFileFacts({ rootId: "folder", files, listing, aliases: repoAliases });
    expect(facts.get("src/a.ts")?.imports).toEqual([{ specifier: "@lib/x", names: ["x"], resolved: "lib/x.ts" }]);
  });

  it("without them (the folder's, which know no `@lib`) the import stays unresolved", async () => {
    const facts = await sideFileFacts({ rootId: "folder", files, listing });
    expect(facts.get("src/a.ts")?.imports[0]?.resolved).toBeUndefined();
  });
});
