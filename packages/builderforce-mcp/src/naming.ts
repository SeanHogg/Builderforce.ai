const IDENTIFIER = /^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/;
const PLATFORM_ID = /^([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)\.([A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*)$/;
const ESCAPE_PREFIX = "encoded-";
const MAX_NAME_LENGTH = 64;

/** Encode escape sequences so dots and literal underscores can round trip. */
function encode(value: string, force = false): string {
  if (!force && IDENTIFIER.test(value) && !value.startsWith(ESCAPE_PREFIX)) return value;
  // TextEncoder would replace a lone surrogate, making a different tool resolve.
  if (/[\uD800-\uDFFF]/u.test(value)) throw new Error("Invalid Unicode in MCP name");
  return ESCAPE_PREFIX + Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decode(value: string): string {
  if (!value.startsWith(ESCAPE_PREFIX)) return value;
  const hex = value.slice(ESCAPE_PREFIX.length);
  if (!/^(?:[\da-f]{2})+$/.test(hex)) throw new Error("Invalid encoded MCP name");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    Uint8Array.from(hex.match(/../g)!, (byte) => Number.parseInt(byte, 16)),
  );
}

export function advertiseName(source: string, tool: string): string {
  if (!source || !tool) throw new Error("An MCP name requires a source and tool");
  const platformId = source === "platform" ? PLATFORM_ID.exec(tool) : null;
  const readableTool = platformId && `${platformId[1]!.replaceAll("_", "-")}_${platformId[2]}`;
  const token = readableTool && !readableTool.startsWith(ESCAPE_PREFIX) ? readableTool : encode(tool, source === "platform");
  const name = `${encode(source)}__${token}`;
  if (name.length > MAX_NAME_LENGTH) throw new Error("MCP name exceeds 64 characters");
  return name;
}

/** The original REST alias for a third-party MCP tool. */
export function legacyExtensionToolName(extensionId: string, tool: string): string {
  const short = extensionId.replace(/-/g, "").slice(0, 8);
  const safeTool = tool.replace(/[^a-zA-Z0-9_]/g, "_");
  return `mcp_${short}_${safeTool}`;
}

export function resolveName(name: string): { source: string; tool: string } | null {
  const [source, tool, extra] = name.split("__");
  if (!source || !tool || extra !== undefined || name.length > MAX_NAME_LENGTH) return null;
  try {
    const decodedSource = decode(source);
    const separator = tool.indexOf("_");
    const decodedTool = decodedSource === "platform" && !tool.startsWith(ESCAPE_PREFIX) && separator >= 0
      ? `${tool.slice(0, separator).replaceAll("-", "_")}.${tool.slice(separator + 1)}`
      : decode(tool);
    const raw = { source: decodedSource, tool: decodedTool };
    return advertiseName(raw.source, raw.tool) === name ? raw : null;
  } catch {
    return null;
  }
}

function counts(names: Iterable<string>): Map<string, number> {
  const result = new Map<string, number>();
  for (const name of names) result.set(name, (result.get(name) ?? 0) + 1);
  return result;
}

/** Build a reversible, catalog-scoped map for provider-facing names. */
export function toolWireNameCodec(
  catalogNames: Iterable<string>,
  wireNames: readonly { name: string; wireName: string }[] | undefined,
) {
  if (!wireNames?.length) return undefined;
  const valid = /^[A-Za-z0-9_-]{1,64}$/;
  const catalog = counts(catalogNames);
  const candidates = wireNames.filter(({ name, wireName }) =>
    valid.test(name) && valid.test(wireName) && catalog.get(name) === 1 && !catalog.has(wireName));
  const names = counts(candidates.map(({ name }) => name));
  const aliases = counts(candidates.map(({ wireName }) => wireName));
  const mappings = candidates.filter(({ name, wireName }) => names.get(name) === 1 && aliases.get(wireName) === 1);
  if (!mappings.length) return undefined;

  const outgoing = new Map(mappings.map(({ name, wireName }) => [name, wireName]));
  const incoming = new Map(mappings.map(({ name, wireName }) => [wireName, name]));
  const mentioned = new RegExp(`(?<![A-Za-z0-9_-])(?:${[...outgoing.keys()].join("|")})(?![A-Za-z0-9_-])`, "g");
  const toWire = (name: string) => outgoing.get(name) ?? name;
  return {
    toWire,
    fromWire: (name: string) => incoming.get(name) ?? name,
    mapPrompt: (text: string) => text.replace(mentioned, toWire),
  };
}

