import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectorySource } from '@seanhogg/builderforce-memory/knowledge';
import type { ReviewPorts } from './reviewJob';
import { LIST_ALL, READ_BYTES, type FromReviewWorker, type ToReviewWorker } from './reviewProtocol';
import { runReview } from './reviewWorkerClient';
import type { ByteReadableSource } from './directorySourceKit';

/** A stored (uncompressed) zip, enough for a docx: the extractor unzips it like any other. */
function storedZip(entries: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const u16 = (n: number) => [n & 255, (n >>> 8) & 255];
  const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
  const local: number[] = [];
  const central: number[] = [];
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = [...enc.encode(name)];
    const data = enc.encode(text);
    const head = [...u32(crc(data)), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)];
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...head,
      ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(local.length), ...nameBytes,
    );
    local.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...head, ...nameBytes, ...data);
  }
  const count = Object.keys(entries).length;
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(central.length), ...u32(local.length), ...u16(0)];
  return Uint8Array.from([...local, ...central, ...end]);
}

const DOCX = storedZip({
  '[Content_Types].xml': '<Types/>',
  'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hello from the docx</w:t></w:r></w:p></w:body></w:document>',
});

const asBuffer = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

function pageSource(): ByteReadableSource {
  return {
    rootId: 'web:upload:r',
    title: 'r',
    async *list() { yield { path: 'plan.docx', hash: 'bytes-hash', size: DOCX.length }; },
    read: async (path) => ({ id: path, tenantId: 'r', title: path, content: { kind: 'text', text: 'RAW-UTF8-GARBAGE', mediaType: 'text/plain' } }),
    readBytes: async () => DOCX,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./reviewJob');
  delete (globalThis as { self?: unknown }).self;
});

describe('document extraction runs in the review worker', () => {
  it('the client answers READ_BYTES with a transferable ArrayBuffer of the file bytes', async () => {
    const posted: Array<{ msg: ToReviewWorker; transfer: Transferable[] }> = [];
    const worker = {
      onmessage: null as ((e: MessageEvent<FromReviewWorker>) => void) | null,
      onerror: null,
      terminate() {},
      postMessage(msg: ToReviewWorker, transfer: Transferable[] = []) {
        posted.push({ msg, transfer });
        queueMicrotask(() => {
          if (msg.type === 'start') this.onmessage?.({ data: { type: 'call', id: 1, port: 'source', method: READ_BYTES, args: ['plan.docx'] } } as MessageEvent<FromReviewWorker>);
          else if (msg.type === 'reply') this.onmessage?.({ data: { type: 'result', value: {} } } as MessageEvent<FromReviewWorker>);
        });
      },
    };
    const ports: ReviewPorts = { source: pageSource(), store: {} as never, manifest: {} as never };
    await runReview({ mode: 'plan', force: false, modelCalls: 0 }, ports, { createWorker: () => worker as unknown as Worker });
    const reply = posted.find((p) => p.msg.type === 'reply')!;
    const value = (reply.msg as { value: unknown }).value;
    expect(value).toBeInstanceOf(ArrayBuffer);
    expect(reply.transfer).toEqual([value]);
    expect(new Uint8Array(value as ArrayBuffer)).toEqual(DOCX);
  });

  it('a .docx reviewed through the worker reads as its extracted text, at the listing hash', async () => {
    const seen: { source?: DirectorySource } = {};
    vi.doMock('./reviewJob', () => ({
      runReviewJob: async (_job: unknown, ports: ReviewPorts) => { seen.source = ports.source; return {}; },
    }));
    const sent: FromReviewWorker[] = [];
    const scope = { postMessage: (m: FromReviewWorker) => { sent.push(m); }, onmessage: null as ((e: MessageEvent<ToReviewWorker>) => void) | null };
    (globalThis as { self?: unknown }).self = scope;
    await import('./knowledgeReview.worker');

    // The page: answers each `call` as the client would (the listing, the bytes).
    const page = pageSource();
    const answer = async (m: Extract<FromReviewWorker, { type: 'call' }>): Promise<unknown> => {
      if (m.method === LIST_ALL) {
        const out = [];
        for await (const e of page.list()) out.push(e);
        return out;
      }
      if (m.method === READ_BYTES) return asBuffer(await page.readBytes(String(m.args[0])));
      return page.read(String(m.args[0]));
    };
    const pump = async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 0));
        for (const m of sent.splice(0)) {
          if (m.type === 'call') scope.onmessage?.({ data: { type: 'reply', id: m.id, ok: true, value: await answer(m) } } as MessageEvent<ToReviewWorker>);
        }
      }
    };
    scope.onmessage?.({
      data: { type: 'start', job: { mode: 'plan', force: false, modelCalls: 0 }, source: { rootId: 'web:upload:r', title: 'r' }, hasJudgement: false, hashesAreContentHash: true },
    } as MessageEvent<ToReviewWorker>);
    await new Promise((r) => setTimeout(r, 0));
    const reading = seen.source!.read('plan.docx');
    await pump();
    const doc = await reading;
    expect(doc.content.kind).toBe('text');
    const text = (doc.content as { text: string }).text;
    expect(text).toContain('Hello from the docx');
    expect(text).not.toContain('RAW-UTF8-GARBAGE');
  });
});
