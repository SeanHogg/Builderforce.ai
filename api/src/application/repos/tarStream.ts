/**
 * A minimal STREAMING tar reader — enough of POSIX ustar + pax + GNU long names to read
 * a GitHub repository tarball as it downloads, in a Worker, without holding the archive.
 *
 * Entries are yielded one at a time; the consumer calls `entry.read()` for the bytes of
 * the ones it wants, and anything it does not read is skipped (still consumed from the
 * stream, never buffered whole). Breaking out of the loop cancels the download.
 * No compression here: pipe the body through `DecompressionStream('gzip')` first.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';

const BLOCK = 512;

export type TarEntryType = 'file' | 'directory' | 'other';

export interface TarEntry {
  path: string;
  size: number;
  type: TarEntryType;
  /** This entry's bytes. Call at most once, before advancing to the next entry. */
  read(): Promise<Uint8Array>;
}

/** Pull exact byte counts out of a chunked stream. */
class ByteReader {
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private done = false;

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private async fill(n: number): Promise<boolean> {
    while (this.buffered < n && !this.done) {
      const { value, done } = await this.reader.read();
      if (done) this.done = true;
      else if (value && value.length > 0) {
        this.chunks.push(value);
        this.buffered += value.length;
      }
    }
    return this.buffered >= n;
  }

  /** Exactly `n` bytes, or null when the stream ends first. */
  async take(n: number): Promise<Uint8Array | null> {
    if (!(await this.fill(n))) return null;
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      const head = this.chunks[0]!;
      const want = n - off;
      if (head.length <= want) {
        out.set(head, off);
        off += head.length;
        this.chunks.shift();
      } else {
        out.set(head.subarray(0, want), off);
        this.chunks[0] = head.subarray(want);
        off += want;
      }
    }
    this.buffered -= n;
    return out;
  }

  /** Drop `n` bytes without copying them. False when the stream ends first. */
  async skip(n: number): Promise<boolean> {
    let left = n;
    while (left > 0) {
      if (this.buffered === 0 && !(await this.fill(1))) return false;
      const head = this.chunks[0]!;
      if (head.length <= left) {
        left -= head.length;
        this.buffered -= head.length;
        this.chunks.shift();
      } else {
        this.chunks[0] = head.subarray(left);
        this.buffered -= left;
        left = 0;
      }
    }
    return true;
  }

  cancel(): void {
    this.reader.cancel().catch((error: unknown) => {
      reportCaughtError(error, { source: 'application/repos/tarStream.ts', operation: 'cancel', level: 'warning' });
    });
  }
}

const decoder = new TextDecoder();

function cString(block: Uint8Array, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const nul = slice.indexOf(0);
  return decoder.decode(nul < 0 ? slice : slice.subarray(0, nul));
}

/** A numeric header field: octal text, or GNU base-256 when the high bit is set. */
function headerNumber(block: Uint8Array, start: number, length: number): number {
  if ((block[start]! & 0x80) !== 0) {
    let n = 0;
    for (let i = start + 1; i < start + length; i += 1) n = n * 256 + block[i]!;
    return n;
  }
  const text = cString(block, start, length).trim();
  return text ? parseInt(text, 8) || 0 : 0;
}

const padded = (size: number): number => Math.ceil(size / BLOCK) * BLOCK;

/** pax extended-header records: `<len> <key>=<value>\n`. */
function paxRecords(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const text = decoder.decode(bytes);
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(' ', i);
    if (space < 0) break;
    const len = Number(text.slice(i, space));
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(space + 1, i + len - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    i += len;
  }
  return out;
}

export async function* readTarEntries(stream: ReadableStream<Uint8Array>): AsyncGenerator<TarEntry> {
  const bytes = new ByteReader(stream.getReader());
  let nextPath: string | null = null;
  let nextSize: number | null = null;
  let finished = false;
  try {
    while (true) {
      const header = await bytes.take(BLOCK);
      if (!header || header.every((b) => b === 0)) {
        finished = true;
        return;
      }
      const flag = String.fromCharCode(header[156]!);
      const headerSize = headerNumber(header, 124, 12);
      if (flag === 'x' || flag === 'g' || flag === 'L') {
        const data = await bytes.take(padded(headerSize));
        if (!data) return;
        const body = data.subarray(0, headerSize);
        if (flag === 'L') nextPath = cString(body, 0, body.length);
        else if (flag === 'x') {
          const pax = paxRecords(body);
          nextPath = pax.get('path') ?? nextPath;
          const paxSize = pax.get('size');
          nextSize = paxSize !== undefined && Number.isFinite(Number(paxSize)) ? Number(paxSize) : null;
        }
        continue;
      }
      const name = cString(header, 0, 100);
      const ustar = cString(header, 257, 6).startsWith('ustar');
      const prefix = ustar ? cString(header, 345, 155) : '';
      const path = nextPath ?? (prefix ? `${prefix}/${name}` : name);
      const size = nextSize ?? headerSize;
      nextPath = null;
      nextSize = null;
      const type: TarEntryType = flag === '0' || flag === '\0' || flag === '7' ? 'file' : flag === '5' ? 'directory' : 'other';
      let consumed = false;
      const entry: TarEntry = {
        path,
        size,
        type,
        read: async () => {
          if (consumed) throw new Error(`tar entry ${path} was already read`);
          consumed = true;
          const data = await bytes.take(padded(size));
          if (!data) throw new Error(`tar stream ended inside ${path}`);
          return data.subarray(0, size);
        },
      };
      yield entry;
      if (!consumed && !(await bytes.skip(padded(size)))) return;
    }
  } finally {
    // A consumer that stops early (a cap was hit) must not leave the download running.
    if (!finished) bytes.cancel();
  }
}
