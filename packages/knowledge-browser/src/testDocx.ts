/** Test fixture: a stored (uncompressed) zip, enough for a docx — the extractor unzips it like any other. */
export function storedZip(entries: Record<string, string>): Uint8Array {
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

/** A minimal .docx whose one paragraph reads `text`. */
export const docxBytes = (text: string): Uint8Array =>
  storedZip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  });
