/**
 * PCM16 and WAV helpers shared by both synthesis paths.
 *
 * The clip's identity hash is taken over the INTERLEAVED little-endian int16
 * sample bytes, not the container: a WAV header can be rewritten (tags, chunk
 * order) without touching the audio, and the on-device path and the server path
 * must hash the same thing. `floatToPcm16` is the ONE quantiser, so the bytes
 * hashed are exactly the bytes a WAV written by `encodeWavPcm16` carries.
 */

/** Quantise float channels (each in [-1, 1]) to interleaved int16. */
export function floatToPcm16(channels: Float32Array[]): Int16Array {
  const nch = channels.length;
  const frames = nch === 0 ? 0 : channels[0]!.length;
  const out = new Int16Array(frames * nch);
  for (let c = 0; c < nch; c++) {
    const ch = channels[c]!;
    for (let i = 0; i < frames; i++) {
      const v = Math.max(-1, Math.min(1, ch[i] ?? 0));
      out[i * nch + c] = Math.round(v * 32767);
    }
  }
  return out;
}

/** Little-endian bytes of int16 samples (host-endianness independent). */
export function pcm16Bytes(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i]!, true);
  return out;
}

/** Encode float channels as a canonical 16-bit PCM WAV. */
export function encodeWavPcm16(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const nch = channels.length;
  const data = pcm16Bytes(floatToPcm16(channels));
  const buf = new ArrayBuffer(44 + data.length);
  const v = new DataView(buf);
  const tag = (off: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + data.length, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * 2, true);
  v.setUint16(32, nch * 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, data.length, true);
  new Uint8Array(buf, 44).set(data);
  return buf;
}

export interface DecodedWav {
  channels: Float32Array[];
  sampleRate: number;
}

/**
 * Decode a RIFF/WAVE holding 16-bit PCM or 32-bit float samples. Returns null
 * for anything else (a compressed codec, 24-bit, a truncated file) so the caller
 * can say honestly that it could not mark that audio, rather than guess.
 */
export function decodeWav(input: ArrayBuffer): DecodedWav | null {
  const located = locateWav(input);
  if (!located) return null;
  const { v, format, nch, sampleRate, bits, dataOff, dataLen } = located;
  const is16 = format === 1 && bits === 16;
  const bytesPer = bits / 8;
  const frames = Math.floor(dataLen / (bytesPer * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const p = dataOff + (i * nch + c) * bytesPer;
      channels[c]![i] = is16 ? v.getInt16(p, true) / 32768 : v.getFloat32(p, true);
    }
  }
  return { channels, sampleRate };
}

/** The raw interleaved little-endian sample bytes of a 16-bit PCM WAV — exactly
 *  what the clip hash covers — or null for any other file. */
export function wavPcm16DataBytes(input: ArrayBuffer): Uint8Array | null {
  const located = locateWav(input);
  if (!located || located.format !== 1 || located.bits !== 16) return null;
  const { nch, dataOff, dataLen } = located;
  const whole = dataLen - (dataLen % (2 * nch));
  return new Uint8Array(input, dataOff, whole);
}

interface LocatedWav {
  v: DataView;
  format: number;
  nch: number;
  sampleRate: number;
  bits: number;
  dataOff: number;
  dataLen: number;
}

/** Find the format and data chunks of a decodable (16-bit PCM or 32-bit float) WAV. */
function locateWav(input: ArrayBuffer): LocatedWav | null {
  if (input.byteLength < 44) return null;
  const v = new DataView(input);
  const tag = (off: number) => String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

  let format = 0;
  let nch = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOff = -1;
  let dataLen = 0;
  let off = 12;
  while (off + 8 <= input.byteLength) {
    const id = tag(off);
    const size = v.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ' && body + 16 <= input.byteLength) {
      format = v.getUint16(body, true);
      nch = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
    } else if (id === 'data') {
      dataOff = body;
      dataLen = Math.min(size, input.byteLength - body);
      break;
    }
    off = body + size + (size % 2);
  }
  if (dataOff < 0 || nch < 1 || sampleRate < 1) return null;
  const is16 = format === 1 && bits === 16;
  const isF32 = format === 3 && bits === 32;
  if (!is16 && !isF32) return null;
  return { v, format, nch, sampleRate, bits, dataOff, dataLen };
}

/** Wrap raw little-endian PCM16 bytes (a vendor's `pcm_*` output) in a WAV header
 *  so the marker can decode it. Odd trailing bytes are dropped. */
export function wrapPcm16AsWav(bytes: Uint8Array, sampleRate: number, channels = 1): ArrayBuffer {
  const len = bytes.length - (bytes.length % 2);
  const buf = new ArrayBuffer(44 + len);
  const v = new DataView(buf);
  const tag = (off: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + len, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, len, true);
  new Uint8Array(buf, 44).set(bytes.subarray(0, len));
  return buf;
}
