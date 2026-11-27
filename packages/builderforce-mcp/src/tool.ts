export type ToolEffect = "read" | "write" | "external";

export interface ToolInputSchema extends Record<string, unknown> {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface McpToolEntry {
  name: string;
  title?: string;
  description: string;
  inputSchema: ToolInputSchema;
  effect: ToolEffect;
  surfaces: readonly string[];
}

/** The existing platform REST representation. Kept at the relay boundary for older clients. */
export interface RelayToolEntry {
  extensionId: string;
  tool: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  mutates?: boolean;
}

export function requiresWriteApproval(tool: { effect: ToolEffect } | { mutates?: boolean }): boolean {
  return "effect" in tool ? tool.effect !== "read" : tool.mutates !== false;
}

export function normalizeInputSchema(schema: Record<string, unknown> = {}): ToolInputSchema {
  const { $schema: _dialect, type: _type, properties, required, ...constraints } = schema;
  return {
    ...constraints,
    type: "object",
    ...(properties && typeof properties === "object" && !Array.isArray(properties)
      ? { properties: properties as Record<string, unknown> }
      : {}),
    ...(Array.isArray(required) && required.every((key) => typeof key === "string") ? { required } : {}),
  };
}

export function toMcp(tool: McpToolEntry | RelayToolEntry) {
  return {
    name: tool.name,
    ...("title" in tool && tool.title !== undefined ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: "inputSchema" in tool ? tool.inputSchema : normalizeInputSchema(tool.parameters),
    annotations: { readOnlyHint: !requiresWriteApproval(tool) },
  };
}

export function fromMcp(
  tool: {
    name: string;
    title?: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean };
  },
  surfaces: readonly string[] = [],
): McpToolEntry {
  const readOnly = tool.annotations?.readOnlyHint;
  return {
    name: tool.name,
    ...(tool.title !== undefined ? { title: tool.title } : {}),
    description: tool.description ?? "",
    inputSchema: normalizeInputSchema(tool.inputSchema),
    effect: readOnly === undefined ? "external" : readOnly ? "read" : "write",
    surfaces,
  };
}

export function toToolEntry(entry: McpToolEntry | RelayToolEntry): McpToolEntry {
  if ("inputSchema" in entry) return entry;
  return {
    name: entry.name,
    description: entry.description,
    inputSchema: normalizeInputSchema(entry.parameters),
    effect: entry.mutates === undefined ? "external" : entry.mutates ? "write" : "read",
    surfaces: [],
  };
}

export function toOpenAI<Schema>(
  tool: { name: string; description: string } & ({ inputSchema: Schema } | { parameters: Schema }),
) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: "inputSchema" in tool ? tool.inputSchema : tool.parameters,
    },
  };
}

export function toAnthropic<Schema>(
  tool: { name: string; description: string; inputSchema: Schema },
): { name: string; description: string; input_schema: Schema };
export function toAnthropic<Schema>(
  tool: { name: string; description?: string; inputSchema: Schema },
): { name: string; description?: string; input_schema: Schema };
export function toAnthropic<Schema>(tool: { name: string; description?: string; inputSchema: Schema }) {
  return {
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    input_schema: tool.inputSchema,
  };
}
