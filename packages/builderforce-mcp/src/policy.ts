import { redactDeep, redactJsonText } from "@builderforce/secret-redaction";
import { fitToolText, shapeToolResult, toolOutputCap } from "@builderforce/tool-output-policy";
import { requiresWriteApproval, type McpToolEntry } from "./tool.js";

export interface ToolGate {
  allows?(tool: McpToolEntry): boolean | Promise<boolean>;
  approveWrite?(tool: McpToolEntry, args: Record<string, unknown>): boolean | Promise<boolean>;
}

export async function canCallTool(
  gate: ToolGate,
  tool: McpToolEntry,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (gate.allows && !await gate.allows(tool)) return false;
  if (!requiresWriteApproval(tool)) return true;
  return await gate.approveWrite?.(tool, args) === true;
}

export function protectToolOutput(tool: string, value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return fitToolText(redactJsonText(value), toolOutputCap(tool), { tool, summarize: true });
  }
  const safeValue = redactDeep(value);
  const shaped = shapeToolResult(tool, safeValue, { summarize: true });
  if (!shaped.truncated) return safeValue;
  try {
    return JSON.parse(shaped.content);
  } catch {
    return { truncated: true, output: fitToolText(shaped.content, toolOutputCap(tool), { tool }) };
  }
}
