import { and, eq, desc } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { toolRuns } from '../../infrastructure/database/schema';
import { TOOLS, getTool } from './toolDefinitions';
import { TOOL_DATA_PROVIDERS, hasDataProvider } from './toolDataProviders';
import { toSummary, toDefinition, type ToolSummary, type ToolDefinition, type ToolResult } from './toolTypes';

export interface SavedToolRun {
  id: string;
  toolId: string;
  kind: string;
  input: Record<string, number>;
  result: ToolResult;
  createdBy: string | null;
  createdAt: string;
}

const runsKey = (tenantId: number, toolId: string) => `tools:runs:tenant:${tenantId}:${toolId}`;
const dataKey = (tenantId: number, toolId: string, days: number) => `tools:data:tenant:${tenantId}:${toolId}:days:${days}`;

export class ToolService {
  constructor(private readonly db: Db) {}

  /** Public — list every free tool (client-safe summaries + data-mode flag). */
  list(): ToolSummary[] {
    return TOOLS.map((t) => ({ ...toSummary(t), hasDataDriven: hasDataProvider(t.id) }));
  }

  /** Public — a tool's full definition (questions / inputs, no compute fn). */
  getDefinition(id: string): ToolDefinition | null {
    const tool = getTool(id);
    if (!tool) return null;
    return { ...toDefinition(tool), hasDataDriven: hasDataProvider(id) };
  }

  /**
   * Pure compute — runs the tool's scorer over the supplied input
   * (calculator values or questionnaire answers). No tenant data is read, so
   * this is safe to expose publicly for the free preview.
   */
  compute(id: string, input: Record<string, number>): ToolResult | null {
    const tool = getTool(id);
    if (!tool) return null;
    return tool.kind === 'calculator' ? tool.compute(input) : tool.score(input);
  }

  /** Whether a tool has a telemetry-derived "from your data" mode. */
  hasDataDriven(id: string): boolean {
    return hasDataProvider(id);
  }

  /** Data-driven result from this workspace's telemetry, cached. Null if no provider. */
  async getDataDriven(env: Env, tenantId: number, id: string, days: number): Promise<ToolResult | null> {
    const provider = TOOL_DATA_PROVIDERS[id];
    if (!provider) return null;
    return getOrSetCached(env, dataKey(tenantId, id, days), () => provider(this.db, tenantId, days), { kvTtlSeconds: 300 });
  }

  /**
   * Persist a run — recomputed server-side so the saved result is authoritative.
   * kind 'self' recomputes from `input` (answers/values); 'data' recomputes from
   * telemetry (input carries { days }).
   */
  async saveRun(env: Env, args: { tenantId: number; toolId: string; kind: 'self' | 'data'; input: Record<string, number>; createdBy?: string | null }): Promise<SavedToolRun | null> {
    let result: ToolResult | null;
    if (args.kind === 'data') {
      const days = Math.min(Math.max(Number(args.input.days ?? 90), 7), 365);
      result = await this.getDataDriven(env, args.tenantId, args.toolId, days);
      args = { ...args, input: { days } };
    } else {
      result = this.compute(args.toolId, args.input);
    }
    if (!result) return null;

    const [row] = await this.db
      .insert(toolRuns)
      .values({
        tenantId: args.tenantId,
        toolId: args.toolId,
        kind: args.kind,
        input: args.input as object,
        result: result as object,
        createdBy: args.createdBy ?? null,
      })
      .returning();
    await invalidateCached(env, runsKey(args.tenantId, args.toolId));
    return this.rowToDto(row!);
  }

  /** Saved run history for a tool, cached + invalidated on save. */
  async listRuns(env: Env, tenantId: number, toolId: string): Promise<SavedToolRun[]> {
    return getOrSetCached(env, runsKey(tenantId, toolId), async () => {
      const rows = await this.db
        .select()
        .from(toolRuns)
        .where(and(eq(toolRuns.tenantId, tenantId), eq(toolRuns.toolId, toolId)))
        .orderBy(desc(toolRuns.createdAt))
        .limit(50);
      return rows.map((r) => this.rowToDto(r));
    }, { kvTtlSeconds: 300 });
  }

  private rowToDto(row: typeof toolRuns.$inferSelect): SavedToolRun {
    return {
      id: row.id,
      toolId: row.toolId,
      kind: row.kind,
      input: (row.input ?? {}) as Record<string, number>,
      result: row.result as ToolResult,
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
