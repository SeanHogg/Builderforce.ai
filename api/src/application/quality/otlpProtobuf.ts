/**
 * Minimal, dependency-free OTLP/protobuf decoder (Cloudflare-Worker safe — no
 * protobufjs / @opentelemetry deps in the API bundle).
 *
 * It does NOT need the .proto schema: a generic protobuf wire-format reader parses
 * bytes into fields keyed by field-number, and the two mappers below walk the
 * STABLE OTLP field numbers (logs.proto / trace.proto) to produce exactly the
 * camelCase JSON shape `otlpAdapter.normalize` already consumes. So the protobuf
 * and JSON ingest paths converge on one adapter (DRY).
 */

type WireType = 0 | 1 | 2 | 5;
interface PbField {
  wt: WireType;
  /** wire type 0 (varint) value as a JS number. */
  varint?: number;
  /** raw payload for wire types 1 (fixed64), 2 (length-delimited), 5 (fixed32). */
  bytes?: Uint8Array;
}
type Fields = Map<number, PbField[]>;

/** Read a base-128 varint at `pos`; returns [value, nextPos]. */
function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 1; // multiply-based to stay precise past 32 bits (up to 2^53)
  let p = pos;
  for (let i = 0; i < 10 && p < buf.length; i++) {
    const b = buf[p++]!;
    result += (b & 0x7f) * shift;
    if ((b & 0x80) === 0) return [result, p];
    shift *= 128;
  }
  return [result, p];
}

/** Decode a protobuf message body into fields keyed by field number. */
function decode(buf: Uint8Array): Fields {
  const out: Fields = new Map();
  const push = (field: number, f: PbField) => {
    const arr = out.get(field);
    if (arr) arr.push(f);
    else out.set(field, [f]);
  };
  let p = 0;
  while (p < buf.length) {
    const [tag, np] = readVarint(buf, p);
    p = np;
    const field = Math.floor(tag / 8);
    const wt = (tag & 7) as WireType;
    if (wt === 0) {
      const [v, n2] = readVarint(buf, p); p = n2; push(field, { wt, varint: v });
    } else if (wt === 1) {
      push(field, { wt, bytes: buf.subarray(p, p + 8) }); p += 8;
    } else if (wt === 2) {
      const [len, n2] = readVarint(buf, p); p = n2; push(field, { wt, bytes: buf.subarray(p, p + len) }); p += len;
    } else if (wt === 5) {
      push(field, { wt, bytes: buf.subarray(p, p + 4) }); p += 4;
    } else {
      break; // unknown wire type — stop rather than mis-parse
    }
  }
  return out;
}

const first = (m: Fields, field: number): PbField | undefined => m.get(field)?.[0];
const str = (f: PbField | undefined): string | undefined => (f?.bytes ? new TextDecoder().decode(f.bytes) : undefined);
const msg = (f: PbField | undefined): Fields => (f?.bytes ? decode(f.bytes) : new Map());

/** fixed64 little-endian → integer (loses precision past 2^53 — fine for ns timestamps in ms). */
function u64(f: PbField | undefined): number | undefined {
  if (!f?.bytes || f.bytes.length < 8) return undefined;
  const dv = new DataView(f.bytes.buffer, f.bytes.byteOffset, 8);
  return dv.getUint32(0, true) + dv.getUint32(4, true) * 2 ** 32;
}
/** fixed64 little-endian → IEEE-754 double. */
function f64(f: PbField | undefined): number | undefined {
  if (!f?.bytes || f.bytes.length < 8) return undefined;
  return new DataView(f.bytes.buffer, f.bytes.byteOffset, 8).getFloat64(0, true);
}

// ── OTLP common: AnyValue / KeyValue / attributes ─────────────────────────────

function anyValueJson(m: Fields): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (m.has(1)) o.stringValue = str(first(m, 1));
  if (m.has(2)) o.boolValue = (first(m, 2)?.varint ?? 0) !== 0;
  if (m.has(3)) o.intValue = first(m, 3)?.varint;
  if (m.has(4)) o.doubleValue = f64(first(m, 4));
  return o;
}
function kvJson(m: Fields): { key?: string; value: Record<string, unknown> } {
  return { key: str(first(m, 1)), value: m.has(2) ? anyValueJson(msg(first(m, 2))) : {} };
}
function attrs(fields: PbField[] | undefined): Array<{ key?: string; value: Record<string, unknown> }> {
  return (fields ?? []).map((f) => kvJson(msg(f)));
}
function resourceAttrs(m: Fields, resourceField: number): { attributes: ReturnType<typeof attrs> } | undefined {
  const r = first(m, resourceField);
  return r ? { attributes: attrs(msg(r).get(1)) } : undefined;
}

// ── OTLP logs (logs.proto) ────────────────────────────────────────────────────
// LogRecord: 1 time(fixed64) · 2 severityNumber(varint) · 3 severityText · 5 body(AnyValue) · 6 attributes
// ScopeLogs: 2 logRecords · ResourceLogs: 1 resource · 2 scopeLogs · LogsData: 1 resourceLogs

function logRecordJson(m: Fields): Record<string, unknown> {
  return {
    timeUnixNano: u64(first(m, 1)),
    severityNumber: first(m, 2)?.varint,
    severityText: str(first(m, 3)),
    body: m.has(5) ? anyValueJson(msg(first(m, 5))) : undefined,
    attributes: attrs(m.get(6)),
  };
}

export function otlpLogsToJson(bytes: Uint8Array): { resourceLogs: unknown[] } {
  const root = decode(bytes);
  return {
    resourceLogs: (root.get(1) ?? []).map((rlF) => {
      const rl = msg(rlF);
      return {
        resource: resourceAttrs(rl, 1),
        scopeLogs: (rl.get(2) ?? []).map((slF) => ({
          logRecords: (msg(slF).get(2) ?? []).map((lrF) => logRecordJson(msg(lrF))),
        })),
      };
    }),
  };
}

// ── OTLP traces (trace.proto) ─────────────────────────────────────────────────
// Span: 5 name · 8 endTime(fixed64) · 9 attributes · 11 events · 15 status
// Span.Event: 1 time(fixed64) · 2 name · 3 attributes · Status: 2 message · 3 code(varint)
// ScopeSpans: 2 spans · ResourceSpans: 1 resource · 2 scopeSpans · TracesData: 1 resourceSpans

function statusJson(m: Fields): Record<string, unknown> {
  return { message: str(first(m, 2)), code: first(m, 3)?.varint };
}
function spanEventJson(m: Fields): Record<string, unknown> {
  return { timeUnixNano: u64(first(m, 1)), name: str(first(m, 2)), attributes: attrs(m.get(3)) };
}
function spanJson(m: Fields): Record<string, unknown> {
  return {
    name: str(first(m, 5)),
    endTimeUnixNano: u64(first(m, 8)),
    attributes: attrs(m.get(9)),
    events: (m.get(11) ?? []).map((f) => spanEventJson(msg(f))),
    status: m.has(15) ? statusJson(msg(first(m, 15))) : undefined,
  };
}

export function otlpTracesToJson(bytes: Uint8Array): { resourceSpans: unknown[] } {
  const root = decode(bytes);
  return {
    resourceSpans: (root.get(1) ?? []).map((rsF) => {
      const rs = msg(rsF);
      return {
        resource: resourceAttrs(rs, 1),
        scopeSpans: (rs.get(2) ?? []).map((ssF) => ({
          spans: (msg(ssF).get(2) ?? []).map((spF) => spanJson(msg(spF))),
        })),
      };
    }),
  };
}
