import { createMcpServer, withInProcessMcp } from "@seanhogg/builderforce-mcp/server";
import { formatCliCommand } from "../cli/command-format.js";
import type { RuntimeEnv } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { isRich, theme } from "../terminal/theme.js";

const DOCS_URL = "https://builderforce.ai/docs/";
const SEARCH_TOOL = "docs__search";
const SEARCH_TIMEOUT_MS = 30_000;
const MAX_RESULTS = 10;

type DocResult = { title: string; link: string };

function docsLinks(xml: string): URL[] {
  const origin = new URL(DOCS_URL).origin;
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), ([, value]) => URL.parse(value.trim()))
    .filter((url): url is URL => url?.origin === origin && !url.username && !url.password && url.pathname.startsWith("/docs/"));
}

async function sitemap(url: URL, signal: AbortSignal): Promise<URL[]> {
  const response = await fetch(url, { signal, redirect: "error" });
  if (!response.ok) throw new Error(`The documentation index returned HTTP ${response.status}.`);
  return docsLinks(await response.text());
}

async function searchPublishedDocs(query: string) {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])];
  if (!terms.length) return [];
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const index = await sitemap(new URL("sitemap-index.xml", DOCS_URL), signal);
  const sections = index.filter(({ pathname }) => /^\/docs\/sitemap-\d+\.xml$/.test(pathname));
  const pages = (await Promise.all(sections.map((url) => sitemap(url, signal)))).flat();
  const matches = new Map<string, DocResult & { score: number }>();
  for (const url of pages) {
    if (/^\/docs\/(?:zh-cn|ja)\//.test(url.pathname)) continue;
    const route = url.pathname.slice("/docs/".length).replace(/\/$/, "");
    const title = route.split("/").pop()?.replace(/[-_]/g, " ");
    if (!title) continue;
    const words = new Set(route.split(/[^a-z0-9]+/i).map((word) => word.toLowerCase()));
    const titleWords = new Set(title.toLowerCase().split(/\s+/));
    const score = terms.reduce((sum, term) => sum + (titleWords.has(term) ? 3 : words.has(term) ? 1 : 0), 0);
    if (score) matches.set(url.href, { title, link: url.href, score });
  }
  return [...matches.values()].sort((a, b) => b.score - a.score || a.link.localeCompare(b.link))
    .slice(0, MAX_RESULTS).map(({ title, link }) => ({ title, link }));
}

async function searchDocs(query: string): Promise<DocResult[]> {
  const server = createMcpServer({
    list: () => [{
      name: SEARCH_TOOL,
      description: "Find documentation pages by topic or command name.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      effect: "read",
      surfaces: ["docs"],
    }],
    async call(_tool, args) {
      if (typeof args.query !== "string") throw new Error("A search query is required.");
      return { results: await searchPublishedDocs(args.query) };
    },
  }, { info: { name: "builderforce-docs", version: "1.0.0" }, gate: {} });
  const result = await withInProcessMcp(server, (client) =>
    client.callTool({ name: SEARCH_TOOL, arguments: { query } }, undefined, { timeout: SEARCH_TIMEOUT_MS + 1_000 }),
  );
  if (result.isError) {
    const error = Array.isArray(result.content) ? result.content.find((block) => block.type === "text")?.text : undefined;
    throw new Error(error ?? "Documentation search failed.");
  }
  const content = result.structuredContent;
  return content && typeof content === "object" && "results" in content && Array.isArray(content.results)
    ? content.results as DocResult[] : [];
}

function escapeMarkdown(text: string): string {
  return text.replace(/[()[\]]/g, "\\$&");
}

function buildMarkdown(query: string, results: DocResult[]): string {
  const lines: string[] = [`# Docs search: ${escapeMarkdown(query)}`, ""];
  if (results.length === 0) {
    lines.push("_No results._");
    return lines.join("\n");
  }
  for (const item of results) {
    const title = escapeMarkdown(item.title);
    lines.push(`- [${title}](${item.link})`);
  }
  return lines.join("\n");
}

function formatLinkLabel(link: string): string {
  return link.replace(/^https?:\/\//i, "");
}

function renderRichResults(query: string, results: DocResult[], runtime: RuntimeEnv) {
  runtime.log(`${theme.heading("Docs search:")} ${theme.info(query)}`);
  if (results.length === 0) {
    runtime.log(theme.muted("No results."));
    return;
  }
  for (const item of results) {
    const linkLabel = formatLinkLabel(item.link);
    const link = formatDocsLink(item.link, linkLabel);
    runtime.log(
      `${theme.muted("-")} ${theme.command(item.title)} ${theme.muted("(")}${link}${theme.muted(")")}`,
    );
  }
}

async function renderMarkdown(markdown: string, runtime: RuntimeEnv) {
  runtime.log(markdown.trimEnd());
}

export async function docsSearchCommand(queryParts: string[], runtime: RuntimeEnv) {
  const query = queryParts.join(" ").trim();
  if (!query) {
    const docs = formatDocsLink(DOCS_URL, "builderforce.ai/docs");
    if (isRich()) {
      runtime.log(`${theme.muted("Docs:")} ${docs}`);
      runtime.log(`${theme.muted("Search:")} ${formatCliCommand('builderforce docs "your query"')}`);
    } else {
      runtime.log(`Docs: ${DOCS_URL}`);
      runtime.log(`Search: ${formatCliCommand('builderforce docs "your query"')}`);
    }
    return;
  }

  let results: DocResult[];
  try {
    results = await searchDocs(query);
  } catch (err) {
    runtime.error(`Docs search failed: ${err instanceof Error ? err.message : String(err)}`);
    runtime.exit(1);
    return;
  }
  if (isRich()) {
    renderRichResults(query, results, runtime);
    return;
  }
  const markdown = buildMarkdown(query, results);
  await renderMarkdown(markdown, runtime);
}
