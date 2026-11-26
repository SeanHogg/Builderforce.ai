import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { searchWorkspaceCodeIndex, type EmbedderPort } from "@seanhogg/builderforce-code-index";
import { buildLocalCapabilityProvider } from "../tools/localCapabilities";

it("persists one root index, ranks code by a warm embedder, and refreshes changed files", async () => {
  const root = await mkdtemp(join(tmpdir(), "bf-code-index-"));
  const cache = join(root, ".builderforce", "index");
  const embedder: EmbedderPort = {
    fingerprint: "two-axis-test-model",
    dims: 2,
    async embed(texts) {
      return texts.map((text) => /ledger|invoice/.test(text)
        ? Float32Array.of(1, 0)
        : Float32Array.of(0, 1));
    },
  };
  const files = buildLocalCapabilityProvider(root).repoRead!;
  const search = (query: string, scope?: string) => searchWorkspaceCodeIndex({
    root, files, query, limit: 1, embedder, ...(scope ? { scope } : {}),
  });
  try {
    await writeFile(join(root, "billing.ts"), "export function book() {\n  return 'ledger';\n}\n");
    await writeFile(join(root, "render.ts"), "export function paint() {\n  return 'color';\n}\n");
    const dense = await search("invoice");
    expect(dense.results?.[0]).toMatchObject({
      path: "billing.ts", source: "embedding", startLine: 1, endLine: 3,
      snippet: expect.stringContaining("return 'ledger'"),
    });
    const indexFiles = (await readdir(cache)).filter((name) => name.endsWith(".idx"));
    expect(indexFiles).toHaveLength(1);
    expect(await readFile(join(cache, ".gitignore"), "utf8")).toBe("*\n");
    const indexPath = join(cache, indexFiles[0]!);
    const first = await readFile(indexPath);
    await search("invoice");
    expect(await readFile(indexPath)).toEqual(first);

    const scoped = await search("invoice", "render.ts");
    expect(scoped.results?.[0]?.path).toBe("render.ts");
    expect(await readFile(indexPath)).toEqual(first);

    await writeFile(join(root, "billing.ts"), "export const settled = 'quarterly receipts';\n");
    await rm(join(root, "render.ts"));
    await expect.poll(async () => (await search("quarterly receipts")).results?.[0]).toMatchObject({
      path: "billing.ts", source: "keyword", snippet: expect.stringContaining("quarterly receipts"),
    });
    expect(await readFile(indexPath)).not.toEqual(first);
  } finally {
    for (const name of await readdir(cache).catch(() => [])) {
      await rm(join(cache, name), { force: true });
    }
    await rmdir(cache).catch(() => undefined);
    await rmdir(join(root, ".builderforce")).catch(() => undefined);
    await rm(join(root, "billing.ts"), { force: true });
    await rm(join(root, "render.ts"), { force: true });
    await rmdir(root);
  }
});
