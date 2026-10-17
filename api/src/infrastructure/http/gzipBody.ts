/**
 * Gzip request bodies at the Worker edge: detect, inflate (bounded), and compress.
 *
 * Extracted from the replay ingest edge so every gzip-capable endpoint (replay
 * beacons, the container-op channel) reads compressed bodies the same way.
 *
 * Gzip is decided by the MAGIC BYTES. `Content-Encoding` is only a hint: a beacon
 * cannot send it, and an edge that already inflated the body leaves it set on JSON —
 * trusting the header would drop a valid body. Inflation is always bounded, so a
 * small body that inflates past the caller's limit is refused as a bomb.
 */

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Read a stream to bytes, or null once it passes `limit` (the stream is cancelled). */
export async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Inflate gzip `bytes`, or null when the result would exceed `maxInflatedBytes`. */
export async function gunzip(bytes: Uint8Array, maxInflatedBytes: number): Promise<Uint8Array | null> {
  const body = new Response(bytes).body;
  if (!body) return null;
  return readBounded(body.pipeThrough(new DecompressionStream('gzip')), maxInflatedBytes);
}

/** Gzip `bytes`. */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const body = new Response(bytes).body;
  if (!body) return new Uint8Array(0);
  return new Uint8Array(await new Response(body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}

/**
 * Parse a JSON request body that may arrive gzipped. Throws on unparseable JSON, a
 * corrupt stream, or an inflation past `maxInflatedBytes` — the same failure a plain
 * `request.json()` raises, so a `parseBody` caller answers it with its usual 400.
 */
export async function readJsonBody(request: Request, maxInflatedBytes: number): Promise<unknown> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const plain = isGzip(bytes) ? await gunzip(bytes, maxInflatedBytes) : bytes;
  if (!plain) throw new Error(`request body inflates past ${maxInflatedBytes} bytes`);
  return JSON.parse(new TextDecoder().decode(plain));
}
