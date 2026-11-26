/**
 * THE web client of the server's built-in tool catalog — the same gateway relay the
 * Brain's tools go through (`/llm/v1/mcp/*`), for the canvas surfaces that call one
 * tool directly instead of through a model turn (the run-target router's container
 * executor, the agent declaration form).
 *
 * Authorization is the server's: every call runs as the signed-in caller, and the tool
 * checks the project against that caller's workspace. Nothing here decides who may call.
 */
import { apiRequest } from '@/lib/apiClient';
import { MCP_CALL_PATH, PLATFORM_EXTENSION_ID, mcpCallRequest, mcpCatalogPath, type RelayCallResult, type RelayCatalog } from '@seanhogg/builderforce-mcp';

type Json = Record<string, unknown>;

export interface BuiltinToolCallOptions {
  /** Statuses the caller handles itself (a 404 it reads as "absent"): no global error toast. */
  expectedErrors?: number[];
}

/** Call one built-in tool and return its result. A relay failure throws (`ApiRequestError`). */
export async function callBuiltinTool(tool: string, args: Json, options: BuiltinToolCallOptions = {}): Promise<unknown> {
  const res = await apiRequest<RelayCallResult>(MCP_CALL_PATH, {
    ...mcpCallRequest({ extensionId: PLATFORM_EXTENSION_ID, tool, arguments: args }),
    ...(options.expectedErrors ? { expectedErrors: options.expectedErrors } : {}),
  });
  return res?.result ?? res;
}

/** The built-in tool keys this caller may run, in catalog order. */
export async function listBuiltinToolKeys(): Promise<string[]> {
  const res = await apiRequest<RelayCatalog>(mcpCatalogPath());
  return (res?.tools ?? []).flatMap((entry) =>
    entry.extensionId === PLATFORM_EXTENSION_ID && typeof entry.tool === 'string' ? [entry.tool] : []);
}
