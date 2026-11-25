import { describe, expect, it, vi } from "vitest";
import { proposeDomainLayout, type DomainLayoutInput } from "@builderforce/agent-tools/knowledge";
import { MAX_DOMAIN_MOVES, organizeDomains, planDomainMoves, rootDomainInput, type DomainPorts } from "./knowledgeDomains";

vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock);

const FILES = ["src/Tools/x.ts", "src/toolA.ts", "src/toolB.ts", "src/chat/y.ts", "src/chatView.ts", "src/app.ts"];
const input = (extra: Partial<DomainLayoutInput> = {}): DomainLayoutInput => ({
  folder: "src",
  files: FILES,
  keepAtRoot: ["app.ts"],
  edges: [{ from: "src/app.ts", to: "src/toolA.ts" }, { from: "src/toolB.ts", to: "src/toolA.ts" }],
  ...extra,
});

function fakePorts(texts: Record<string, string>) {
  const calls: string[] = [];
  const written = new Map<string, string>();
  const ports: DomainPorts = {
    read: async (p) => { calls.push(`read ${p}`); return texts[p] ?? ""; },
    write: async (p, text) => { calls.push(`write ${p}`); written.set(p, text); },
    move: async (from, to) => { calls.push(`move ${from} ${to}`); },
  };
  return { ports, calls, written };
}

describe("planDomainMoves", () => {
  const layout = proposeDomainLayout(input());

  it("plans the moves of the accepted domains, with every path they touch (old, new and the importers)", () => {
    const plan = planDomainMoves(input(), layout, ["Tools"]);
    expect(plan.moves.map((m) => [m.from, m.to])).toEqual([["src/toolA.ts", "src/Tools/toolA.ts"], ["src/toolB.ts", "src/Tools/toolB.ts"]]);
    expect([...plan.wanted].sort()).toEqual(["src/Tools/toolA.ts", "src/Tools/toolB.ts", "src/app.ts", "src/toolA.ts", "src/toolB.ts"]);
    expect(plan.rewrite).toEqual(["src/app.ts", "src/toolA.ts", "src/toolB.ts"]);
  });

  it("refuses an unknown or malformed domain id, and an empty choice", () => {
    expect(() => planDomainMoves(input(), layout, ["nope"])).toThrow(/not a domain/);
    expect(() => planDomainMoves(input(), layout, ["../etc"])).toThrow(/not a domain/);
    expect(() => planDomainMoves(input(), layout, ["Tools/../x"])).toThrow(/not a domain/);
    expect(() => planDomainMoves(input(), layout, [])).toThrow(/has a file to move/);
  });

  it("caps the number of moves", () => {
    const many = Array.from({ length: MAX_DOMAIN_MOVES + 1 }, (_, i) => ({ from: `src/f${i}.ts`, to: `src/D/f${i}.ts`, domain: "D", reason: "name" as const }));
    const big = { ...layout, domains: [{ id: "D", isNew: true, files: [] }], moves: many };
    expect(() => planDomainMoves(input(), big, ["D"])).toThrow(/limit is 2000/);
  });

  it("refuses a move that leaves the root", () => {
    const evil = { ...layout, moves: [{ from: "src/toolA.ts", to: "../outside/toolA.ts", domain: "Tools", reason: "name" as const }] };
    expect(() => planDomainMoves(input(), evil, ["Tools"])).toThrow(/outside the folder/);
  });
});

describe("rootDomainInput", () => {
  it("refuses a folder that escapes the root before touching the disk", async () => {
    const graph = { nodes: [], edges: [] } as never;
    await expect(rootDomainInput(graph, "r", "../elsewhere", "/nowhere")).rejects.toThrow(/outside the folder/);
    await expect(rootDomainInput(graph, "r", "C:\Windows", "/nowhere")).rejects.toThrow(/outside the folder/);
  });
});

describe("organizeDomains", () => {
  const files = new Set(FILES);

  it("reads once, moves with git, then writes the rewritten texts at the new paths; changed holds the old and the new path of every move", async () => {
    const plan = planDomainMoves(input(), proposeDomainLayout(input()), ["Tools"]);
    const { ports, calls, written } = fakePorts({
      "src/app.ts": "import { a } from './toolA';",
      "src/toolA.ts": "import { b } from './toolB';\nimport { c } from './chatView';",
      "src/toolB.ts": "export const b = 1;",
    });
    const out = await organizeDomains(ports, plan, files);
    expect(calls.filter((c) => c.startsWith("read")).length).toBe(3);
    expect(calls.findIndex((c) => c.startsWith("write"))).toBeGreaterThan(calls.findIndex((c) => c.startsWith("move")));
    expect(written.get("src/app.ts")).toBe("import { a } from './Tools/toolA';");
    expect(written.get("src/Tools/toolA.ts")).toBe("import { b } from './toolB';\nimport { c } from '../chatView';");
    expect(written.has("src/Tools/toolB.ts")).toBe(false);
    expect(out.rewritten).toBe(2);
    for (const m of plan.moves) expect(out.changed).toEqual(expect.arrayContaining([m.from, m.to]));
  });
});
