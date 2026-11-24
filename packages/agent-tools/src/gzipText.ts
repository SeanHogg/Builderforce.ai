/**
 * The one gzip inflater and compressor (PRD 49 §5). `DecompressionStream` /
 * `CompressionStream`, not `node:zlib`. `read_file` and any search reader call the
 * inflater; a writer of a `.gz` artifact (a knowledge pack) calls {@link gzipText}.
 * `read_compressed` calls neither.
 */
export async function readGzipText(bytes: Uint8Array): Promise<string> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(bytes as BufferSource);
  await writer.close();
  const decoded = await new Response(stream.readable).arrayBuffer();
  return new TextDecoder().decode(decoded);
}

/** UTF-8 `text` as gzip bytes — the inverse of {@link readGzipText}. */
export async function gzipText(text: string): Promise<Uint8Array> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(new TextEncoder().encode(text) as BufferSource);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
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
