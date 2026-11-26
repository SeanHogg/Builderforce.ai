const IDENTIFIER = /^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;

/** Encode escape sequences so dots and literal underscores can round trip. */
function encode(value: string, force = false): string {
  if (!force && IDENTIFIER.test(value) && !value.startsWith("encoded-")) return value;
  return "encoded-" + Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decode(value: string): string {
  if (!value.startsWith("encoded-")) return value;
  const hex = value.slice("encoded-".length);
  if (!/^(?:[\da-f]{2})+$/.test(hex)) throw new Error("Invalid encoded MCP name");
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    Uint8Array.from(hex.match(/../g)!, (byte) => Number.parseInt(byte, 16)),
  );
}

export function advertiseName(source: string, tool: string): string {
  if (!source || !tool) throw new Error("An MCP name requires a source and tool");
  const platformId = source === "platform" && /^[A-Za-z0-9]+\.[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/.test(tool);
  const name = `${encode(source)}__${platformId ? tool.replace(".", "_") : encode(tool, source === "platform")}`;
  if (name.length > MAX_NAME_LENGTH) throw new Error("MCP name exceeds 64 characters");
  return name;
}

export function resolveName(name: string): { source: string; tool: string } | null {
  const [source, tool, extra] = name.split("__");
  if (!source || !tool || extra !== undefined || name.length > MAX_NAME_LENGTH) return null;
  try {
    const decodedSource = decode(source);
    const decodedTool = decodedSource === "platform" && !tool.startsWith("encoded-")
      ? tool.replace("_", ".")
      : decode(tool);
    const raw = { source: decodedSource, tool: decodedTool };
    return advertiseName(raw.source, raw.tool) === name ? raw : null;
  } catch {
    return null;
  }
}

