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

