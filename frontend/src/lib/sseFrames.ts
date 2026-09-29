/**
 * Server-sent events, read ONCE.
 *
 * Four streaming calls (`sendAIMessage`, `generateDataset`, `streamTrainingLogs`,
 * the knowledge AI draft) each walked a `ReadableStream` into `data:` lines by
 * hand. Two of them split each network chunk on its own, so a JSON frame that
 * straddled a chunk boundary was two unparseable halves — silently dropped by
 * the `catch` beneath. The buffering that the other two had is now what all four
 * get: a line is only parsed once its newline has arrived.
 *
 * Yields each frame's payload text; the caller parses, because the four wire
 * shapes differ. Ends on the `[DONE]` sentinel every one of these streams sends.
 */
export async function* readSseData(
  body: ReadableStream<Uint8Array> | null | undefined,
): AsyncGenerator<string, void, unknown> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const data = sseDataPayload(line);
        if (data === undefined) continue;
        if (data === '[DONE]') return;
        yield data;
      }
    }
    const tail = sseDataPayload(buffer);
    if (tail !== undefined && tail !== '[DONE]') yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** The payload of a `data:` line, or `undefined` for any other line. Tolerates
 *  the spaceless `data:{…}` form as well as `data: {…}`. */
export function sseDataPayload(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return undefined;
  return trimmed.slice(5).trim();
}
