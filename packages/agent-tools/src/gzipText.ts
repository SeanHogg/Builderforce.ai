/**
 * The one gzip inflater (PRD 49 §5). `DecompressionStream`, not `node:zlib`.
 * `read_file` and any search reader call this. `read_compressed` does not.
 */
export async function readGzipText(bytes: Uint8Array): Promise<string> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(bytes as BufferSource);
  await writer.close();
  const decoded = await new Response(stream.readable).arrayBuffer();
  return new TextDecoder().decode(decoded);
}

/** Latin-1 bytes of a string a file reader stored without decoding. */
export function latin1Bytes(content: string): Uint8Array {
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i) & 0xff;
  return bytes;
}

/** True when `path` is a gzip file the readers should inflate. */
export function isGzipPath(path: string): boolean {
  return path.toLowerCase().endsWith(".gz");
}
