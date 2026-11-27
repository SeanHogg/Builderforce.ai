import type { BrainRunRequest, BrainStreamFn } from '../runStore/runTypes';
import { TOOL_ROUTER_DESCRIBE, TOOL_ROUTER_FIND, TOOL_ROUTER_INVOKE } from '../toolRouter';

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function counts(names: Iterable<string>): Map<string, number> {
  const result = new Map<string, number>();
  for (const name of names) result.set(name, (result.get(name) ?? 0) + 1);
  return result;
}

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
  if (!wireToolNames?.length) return { stream };

  const catalog = counts(tools?.map((tool) => tool.function.name) ?? []);
  const candidates = wireToolNames.filter(({ name, wireName }) =>
    TOOL_NAME.test(name) && TOOL_NAME.test(wireName)
    && catalog.get(name) === 1 && !catalog.has(wireName));
  const names = counts(candidates.map(({ name }) => name));
  const wireNames = counts(candidates.map(({ wireName }) => wireName));
  const mappings = candidates.filter(({ name, wireName }) =>
    names.get(name) === 1 && wireNames.get(wireName) === 1);
  if (!mappings.length) return { stream };

  const outgoing = new Map(mappings.map(({ name, wireName }) => [name, wireName]));
  const incoming = new Map(mappings.map(({ name, wireName }) => [wireName, name]));
  const mentioned = new RegExp(`(?<![A-Za-z0-9_-])(?:${[...outgoing.keys()].join('|')})(?![A-Za-z0-9_-])`, 'g');
  const toWire = (name: string) => outgoing.get(name) ?? name;
  const fromWire = (name: string) => incoming.get(name) ?? name;
  const mapPrompt = (text: string) => text.replace(mentioned, toWire);

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
