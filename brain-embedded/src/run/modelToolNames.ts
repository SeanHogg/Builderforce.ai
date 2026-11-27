import { toolWireNameCodec } from '@seanhogg/builderforce-mcp';
import type { BrainRunRequest, BrainStreamFn } from '../runStore/runTypes';
import { TOOL_ROUTER_DESCRIBE, TOOL_ROUTER_FIND, TOOL_ROUTER_INVOKE } from '../toolRouter';

function mapRouterTarget(tool: string, args: string, mapName: (name: string) => string): string {
  const key = tool === TOOL_ROUTER_FIND ? 'query'
    : tool === TOOL_ROUTER_DESCRIBE || tool === TOOL_ROUTER_INVOKE ? 'name' : undefined;
  if (!key) return args;
  try {
    const value = JSON.parse(args) as Record<string, unknown> | null;
    const target = value?.[key];
    if (typeof target !== 'string') return args;
    const next = mapName(target);
    return next === target ? args : JSON.stringify({ ...value, [key]: next });
  } catch {
    // Malformed arguments reach the run's normal validation unchanged.
    return args;
  }
}

/** Translate only at the provider boundary. The run continues to use the catalog's
 * policy names for approval, scheduling, tracing, and every dispatch. */
export function modelToolNames(req: Pick<BrainRunRequest, 'stream' | 'tools' | 'wireToolNames'>): {
  stream: BrainStreamFn;
  mapPrompt?: (text: string) => string;
} {
  const { stream, tools, wireToolNames } = req;
  const codec = toolWireNameCodec(tools?.map((tool) => tool.function.name) ?? [], wireToolNames);
  if (!codec) return { stream };
  const { toWire, fromWire, mapPrompt } = codec;

  const wired: BrainStreamFn = async (options, handlers) => {
    const onToolCallDelta = handlers?.onToolCallDelta;
    const result = await stream({
      ...options,
      ...(options.tools ? { tools: options.tools.map((tool) => {
        const name = toWire(tool.function.name);
        return name === tool.function.name ? tool : { ...tool, function: { ...tool.function, name } };
      }) } : {}),
      messages: options.messages.map((message) => {
        const content = message.role === 'system' && typeof message.content === 'string'
          ? mapPrompt(message.content)
          : message.content;
        const calls = message.tool_calls?.map((call) => {
          const name = toWire(call.function.name);
          const args = mapRouterTarget(call.function.name, call.function.arguments, toWire);
          return name === call.function.name && args === call.function.arguments ? call : {
            ...call, function: { ...call.function, name, arguments: args },
          };
        });
        if (content === message.content && !calls?.some((call, index) => call !== message.tool_calls?.[index])) return message;
        return {
          ...message,
          content,
          ...(calls ? { tool_calls: calls } : {}),
        };
      }),
    }, onToolCallDelta ? {
      ...handlers,
      onToolCallDelta: (index, delta) => onToolCallDelta(index, delta.name
        ? { ...delta, name: fromWire(delta.name) } : delta),
    } : handlers);
    return { ...result, toolCalls: result.toolCalls.map((call) => {
      const name = fromWire(call.name);
      return { ...call, name, args: mapRouterTarget(name, call.args, fromWire) };
    }) };
  };
  return { stream: wired, mapPrompt };
}
