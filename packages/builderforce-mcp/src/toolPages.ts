export async function listMcpToolPages<T>(
  fetchPage: (cursor?: string) => Promise<{ tools: readonly T[]; nextCursor?: unknown }>,
): Promise<T[]> {
  const tools: T[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await fetchPage(cursor);
    tools.push(...result.tools);
    if (typeof result.nextCursor !== "string" || !result.nextCursor) return tools;
    cursor = result.nextCursor;
    if (cursors.has(cursor)) throw new Error("MCP server repeated a tools/list cursor");
    cursors.add(cursor);
  }
  throw new Error("MCP tool catalog exceeded 20 pages");
}
