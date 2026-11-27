import { afterEach, expect, it, vi } from "vitest";
import { docsSearchCommand } from "./docs.js";

afterEach(() => vi.unstubAllGlobals());

it("searches the published docs through MCP and reads only the docs sitemap", async () => {
  const index = "https://builderforce.ai/docs/sitemap-index.xml";
  const section = "https://builderforce.ai/docs/sitemap-0.xml";
  const fetcher = vi.fn(async (url: URL) => {
    if (url.href === index) {
      return new Response(`<sitemapindex><sitemap><loc>${section}</loc></sitemap><sitemap><loc>https://elsewhere.example/docs/sitemap-0.xml</loc></sitemap></sitemapindex>`);
    }
    expect(url.href).toBe(section);
    return new Response("<urlset><url><loc>https://builderforce.ai/docs/gateway/mcp</loc></url><url><loc>https://builderforce.ai/docs/help/install</loc></url></urlset>");
  });
  vi.stubGlobal("fetch", fetcher);
  const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
  await docsSearchCommand(["Workspace", "MCP"], runtime);
  expect(fetcher.mock.calls.map(([url]) => url.href)).toEqual([index, section]);
  expect(runtime.log.mock.calls.flat().join(" ")).toContain("https://builderforce.ai/docs/gateway/mcp");
  expect(runtime.log.mock.calls.flat().join(" ")).not.toContain("/help/install");
  expect(runtime.error).not.toHaveBeenCalled();
});
