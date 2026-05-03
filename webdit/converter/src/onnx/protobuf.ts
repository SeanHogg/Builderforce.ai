/**
 * Minimal protobuf wire-format codec. Hand-rolled to avoid pulling in
 * protobufjs — we only need ~5 ONNX message types and a few wire kinds.
 *
 * Wire format reference:
 *   tag      = (fieldNumber << 3) | wireType   (varint-encoded)
 *   wireType = 0 varint | 1 fixed64 | 2 length-delimited | 5 fixed32
 */

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_LENGTH = 2;
export const WIRE_FIXED32 = 5;

export class ProtobufWriter {
  private buf: Uint8Array = new Uint8Array(256);
  private len = 0;

  private ensure(extra: number): void {
    while (this.len + extra > this.buf.byteLength) {
      const next = new Uint8Array(this.buf.byteLength * 2);
      next.set(this.buf);
      this.buf = next;
    }
  }

  writeByte(b: number): void {
    this.ensure(1);
    this.buf[this.len++] = b & 0xff;
  }

  writeTag(fieldNumber: number, wireType: number): void {
    this.writeVarint((fieldNumber << 3) | wireType);
  }

  writeVarint(value: number | bigint): void {
    let v = typeof value === "bigint" ? value : BigInt(value);
    if (v < 0n) {
      // Two's-complement encoding to 64 bits per protobuf spec.
      v = (1n << 64n) + v;
    }
    while (v >= 0x80n) {
      this.writeByte(Number(v & 0x7fn) | 0x80);
      v >>= 7n;
    }
    this.writeByte(Number(v));
  }

  writeFixed32Float(value: number): void {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    const u8 = new Uint8Array(buf);
    this.ensure(4);
    this.buf.set(u8, this.len);
    this.len += 4;
  }

  writeRawBytes(bytes: Uint8Array): void {
    this.ensure(bytes.byteLength);
    this.buf.set(bytes, this.len);
    this.len += bytes.byteLength;
  }

  writeBytesField(fieldNumber: number, bytes: Uint8Array): void {
    this.writeTag(fieldNumber, WIRE_LENGTH);
    this.writeVarint(bytes.byteLength);
    this.writeRawBytes(bytes);
  }

  writeStringField(fieldNumber: number, s: string): void {
    this.writeBytesField(fieldNumber, new TextEncoder().encode(s));
  }

  writeMessageField(fieldNumber: number, msgBytes: Uint8Array): void {
    this.writeBytesField(fieldNumber, msgBytes);
  }

  writeVarintField(fieldNumber: number, value: number | bigint): void {
    this.writeTag(fieldNumber, WIRE_VARINT);
    this.writeVarint(value);
  }

  writeFloatField(fieldNumber: number, value: number): void {
    this.writeTag(fieldNumber, WIRE_FIXED32);
    this.writeFixed32Float(value);
  }

  /** Repeated packed int64. */
  writePackedInt64Field(fieldNumber: number, values: ReadonlyArray<number | bigint>): void {
    const inner = new ProtobufWriter();
    for (const v of values) inner.writeVarint(v);
    this.writeBytesField(fieldNumber, inner.toBytes());
  }

  /** Repeated packed float32. */
  writePackedFloatField(fieldNumber: number, values: ReadonlyArray<number>): void {
    const inner = new ProtobufWriter();
    for (const v of values) inner.writeFixed32Float(v);
    this.writeBytesField(fieldNumber, inner.toBytes());
  }

  toBytes(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

export class ProtobufReader {
  private offset = 0;

  constructor(private readonly buf: Uint8Array) {}

  hasMore(): boolean {
    return this.offset < this.buf.byteLength;
  }

  readTag(): { fieldNumber: number; wireType: number } {
    const v = this.readVarintBig();
    return { fieldNumber: Number(v >> 3n), wireType: Number(v & 7n) };
  }

  readVarintBig(): bigint {
    let v = 0n;
    let shift = 0n;
    while (true) {
      if (this.offset >= this.buf.byteLength) {
        throw new Error("protobuf: unexpected end of buffer in varint");
      }
      const b = this.buf[this.offset++]!;
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7n;
    }
    return v;
  }

  readVarint(): number {
    return Number(this.readVarintBig());
  }

  readBytes(): Uint8Array {
    const len = this.readVarint();
    const out = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return out;
  }

  readString(): string {
    return new TextDecoder().decode(this.readBytes());
  }

  readFixed32Float(): number {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.offset, 4);
    this.offset += 4;
    return view.getFloat32(0, true);
  }

  skip(wireType: number): void {
    switch (wireType) {
      case WIRE_VARINT:
        this.readVarintBig();
        return;
      case WIRE_FIXED64:
        this.offset += 8;
        return;
      case WIRE_LENGTH:
        this.readBytes();
        return;
      case WIRE_FIXED32:
        this.offset += 4;
        return;
      default:
        throw new Error(`protobuf: unknown wire type ${wireType}`);
    }
  }
}
