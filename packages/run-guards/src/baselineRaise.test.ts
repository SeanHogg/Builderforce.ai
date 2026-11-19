import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { baselineRaiseRefusal, baselineRaises, isBaselineFile, ownsBaselineRaise } from "./baselineRaise.js";

/** The real commit VS Code chat #275 pushed: `check-react-hooks-ratchet.mjs --update` grandfathering new warnings. */
const C9C043248 = readFileSync(new URL("./__fixtures__/c9c043248-react-hooks-baseline.diff", import.meta.url), "utf8");

function diffOf(path: string, hunk: string): string {
  return `diff --git a/${path} b/${path}\nindex 1..2 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@\n${hunk}\n`;
}

describe("baselineRaises", () => {
  it("reports every entry c9c043248 added or raised — and none it lowered or moved", () => {
    const raises = baselineRaises(C9C043248);
    const file = "frontend/scripts/.react-hooks-baseline.txt";
    expect(raises).toEqual(
      expect.arrayContaining([
        { file, key: "src/app/personas/PersonasClient.tsx", from: 1, to: 2 },
        { file, key: "src/app/knowledge/[id]/KnowledgeDocClient.tsx", from: null, to: 1 },
        { file, key: "src/app/voice/verify/VoiceVerifyClient.tsx", from: null, to: 1 },
        { file, key: "src/components/governance/RunScanPanel.tsx", from: null, to: 3 },
        { file, key: "src/lib/useKanbanTemplateCheckout.ts", from: null, to: 1 },
      ]),
    );
    expect(raises).toHaveLength(9);
    const keys = raises.map((r) => r.key);
    expect(keys).not.toContain("src/app/incidents/IncidentsPageClient.tsx");
    expect(keys).not.toContain("src/app/prompts/PromptsPageClient.tsx");
  });

  it("reads the JSON, path:N and design-scale BASELINE shapes", () => {
    expect(baselineRaises(diffOf("frontend/scripts/.raw-storage-baseline.json", '-  "count": 123\n+  "count": 124'))).toEqual([
      { file: "frontend/scripts/.raw-storage-baseline.json", key: "count", from: 123, to: 124 },
    ]);
    expect(baselineRaises(diffOf("api/scripts/.tenant-scope-baseline.txt", "+application/a.ts:2"))).toEqual([
      { file: "api/scripts/.tenant-scope-baseline.txt", key: "application/a.ts", from: null, to: 2 },
    ]);
    expect(baselineRaises(diffOf("frontend/scripts/check-design-scale.mjs", "-  themeLockedColours: 273,\n+  themeLockedColours: 280,\n+  const x = 1;"))).toEqual([
      { file: "frontend/scripts/check-design-scale.mjs", key: "themeLockedColours", from: 273, to: 280 },
    ]);
    expect(baselineRaises(diffOf("api/scripts/.layering-baseline.txt", "+# a comment\n+presentation/x.ts"))).toEqual([
      { file: "api/scripts/.layering-baseline.txt", key: "presentation/x.ts", from: null, to: null },
    ]);
  });

  it("ignores lowered counts, removals and files that are not baselines", () => {
    expect(baselineRaises(diffOf("frontend/scripts/.react-hooks-baseline.txt", "-src/a.tsx 3\n+src/a.tsx 2\n-src/b.tsx 1"))).toEqual([]);
    expect(baselineRaises(diffOf("frontend/src/a.ts", "+foo: 3,"))).toEqual([]);
    expect(isBaselineFile("api/scripts/.layering-baseline.txt")).toBe(true);
    expect(isBaselineFile("frontend/scripts/.frontend-architecture-baseline.json")).toBe(true);
    expect(isBaselineFile("clients/vscode/src/runChangeBaseline.ts")).toBe(false);
    // A perf snapshot moves both ways; it is not a ratchet.
    expect(isBaselineFile("packages/knowledge-graph-view/src/perf/deterministic/baseline.gate.json")).toBe(false);
    expect(baselineRaises(diffOf("packages/knowledge-graph-view/src/perf/deterministic/baseline.gate.json", '-  "p95": 10\n+  "p95": 12'))).toEqual([]);
  });

  it("treats a rename that keeps the total as a move, not a raise", () => {
    const file = "frontend/scripts/.react-hooks-baseline.txt";
    expect(baselineRaises(diffOf(file, "-src/old.tsx 3\n+src/new.tsx 3"))).toEqual([]);
    expect(baselineRaises(diffOf(file, "-src/old.tsx 3\n+src/new.tsx 2"))).toEqual([]);
    // A rename that also grows the total is not a move.
    expect(baselineRaises(diffOf(file, "-src/old.tsx 3\n+src/new.tsx 4"))).toEqual([{ file, key: "src/new.tsx", from: null, to: 4 }]);
    // Two new entries cannot both be matched by one removed entry.
    expect(baselineRaises(diffOf(file, "-src/old.tsx 3\n+src/a.tsx 1\n+src/b.tsx 1"))).toHaveLength(2);
  });

  it("keys JSON entries by their section", () => {
    const file = "frontend/scripts/.frontend-architecture-baseline.json";
    const json = [
      " {",
      '   "oversizedProductionFileLines": {',
      '-    "app/a.tsx": 1174',
      '+    "app/a.tsx": 1100',
      "   },",
      '   "hookCounts": {',
      '-    "app/b.tsx": 2',
      '+    "app/a.tsx": 2',
      "   }",
      " }",
    ].join("\n");
    // `app/a.tsx` fell in one section and appeared in another: the move matches b.tsx's removal, so nothing is raised —
    // and the size section's key is never confused with the hooks section's.
    expect(baselineRaises(diffOf(file, json))).toEqual([]);
    const grown = json.replace('-    "app/b.tsx": 2\n', "");
    expect(baselineRaises(diffOf(file, grown))).toEqual([{ file, key: "hookCounts > app/a.tsx", from: null, to: 2 }]);
  });
});

describe("ownsBaselineRaise / baselineRaiseRefusal", () => {
  it("needs a trailer WITH a reason", () => {
    expect(ownsBaselineRaise("Record ratchet improvement")).toBe(false);
    expect(ownsBaselineRaise("Fix guard\n\nbaseline-raise:")).toBe(false);
    expect(ownsBaselineRaise("Split panel\n\nbaseline-raise: RunScanPanel moved from the old path; same 3 warnings")).toBe(true);
  });

  it("lists every raise in the refusal", () => {
    const text = baselineRaiseRefusal(baselineRaises(C9C043248));
    expect(text).toContain("src/app/personas/PersonasClient.tsx 1 → 2");
    expect(text).toContain("baseline-raise:");
  });
});
