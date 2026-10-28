import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

import type { CapabilityProvider } from "@builderforce/agent-tools";
import type { DetectedTool, DetectedTools } from "@builderforce/agent-tools/prefetch";
import { runGate } from "@builderforce/prefetch";
import { createVscodePrefetchPort } from "./vscodePrefetchPort";
import type { ToolDetector } from "./detectTools";

/** A detector that knows `tools` once `ensure` ran — what `prepare` must wait for. */
function detector(tools: DetectedTools): ToolDetector & { ensured: number } {
  let known: DetectedTools | undefined;
  const d = {
    ensured: 0,
    current: () => known,
    ensure: async () => {
      d.ensured++;
      known = tools;
      return tools;
    },
    invalidate: () => { known = undefined; },
  };
  return d;
}

function fakeCaps() {
  const commands: string[] = [];
  const caps = {
    capabilities: new Set(),
    shell: { run: vi.fn(async (command: string) => { commands.push(command); return { ok: true, exitCode: 0, stdout: "done" }; }) },
  } as unknown as CapabilityProvider;
  return { caps, commands };
}

const npm = (id: string): DetectedTool => ({ id, via: "dependency", command: `npm exec --no -- ${id}` });

/** One gate pass over the port, adopting any answer. */
async function pass(port: ReturnType<typeof createVscodePrefetchPort>, request: string, confirm?: () => Promise<boolean>) {
  const adopted: string[] = [];
  const result = await runGate(request, port, {
    ...(confirm ? { confirm } : {}),
    adopt: async ({ result: r }) => { adopted.push(r.text); return true; },
  });
  return { result, adopted };
}

describe("the editor's PreFetch port", () => {
  it("finishes tool detection before the gate reads it, and offers the rows those tools back", async () => {
    const tools = detector(new Map([["prisma", npm("prisma")]]));
    const { caps, commands } = fakeCaps();
    const port = createVscodePrefetchPort({ root: () => "/w", tools, caps: () => caps });
    expect([...port.ports.tools!]).toEqual([]);
    const { result } = await pass(port, "/prisma-generate", async () => true);
    expect(tools.ensured).toBe(1);
    expect(result?.settled).toBe("answer");
    expect(commands).toEqual(["npm exec --no -- prisma generate"]);
  });

  it("a write action never runs without the confirm — the port supplies none of its own", async () => {
    const { caps, commands } = fakeCaps();
    const port = createVscodePrefetchPort({ root: () => "/w", tools: detector(new Map([["formatter", npm("prettier")]])), caps: () => caps });
    expect(port.confirm).toBeUndefined();
    const declined = await pass(port, "/format");
    expect(declined.result?.settled).not.toBe("answer");
    expect(declined.result?.ran).toEqual([expect.objectContaining({ confirmed: false, result: undefined })]);
    expect(commands).toEqual([]);
    const refused = await pass(port, "/format", async () => false);
    expect(refused.adopted).toEqual([]);
    expect(commands).toEqual([]);
    const confirmed = await pass(port, "/format", async () => true);
    expect(confirmed.adopted).toHaveLength(1);
    expect(commands).toEqual(["npm exec --no -- prettier --write ."]);
  });

  it("skips an action whose tool is missing: not offered, nothing runs", async () => {
    const { caps, commands } = fakeCaps();
    const port = createVscodePrefetchPort({ root: () => "/w", tools: detector(new Map()), caps: () => caps });
    const { result } = await pass(port, "/dup");
    expect(result?.settled).toBe("llm");
    expect(commands).toEqual([]);
  });

  it("diag.typecheck asks the language servers first and falls back to tsc only without them", async () => {
    const { caps, commands } = fakeCaps();
    const tools = detector(new Map([["typescript", npm("tsc")]]));
    const lsp = createVscodePrefetchPort({
      root: () => "/w", tools, caps: () => caps,
      diagnostics: async () => ({ available: true, lines: ["src/a.ts:1:1 error Nope (ts 2322)"], files: 1 }),
    });
    await tools.ensure("/w");
    const out = await lsp.executors["diag.typecheck"]!.run("/typecheck", new AbortController().signal);
    expect(out?.text).toContain("src/a.ts:1:1 error Nope");
    expect(commands).toEqual([]);
    const none = createVscodePrefetchPort({ root: () => "/w", tools, caps: () => caps, diagnostics: async () => ({ available: false, lines: [] }) });
    await none.executors["diag.typecheck"]!.run("/typecheck", new AbortController().signal);
    expect(commands).toEqual(["npm exec --no -- tsc --noEmit --pretty false"]);
  });
});
