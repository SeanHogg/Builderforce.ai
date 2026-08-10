export interface LoRASafetensorsInfo {
  metadata: Record<string, string>;
  tensorNames: string[];
}

/** Validate the container and LoRA tensor contract before accepting an artifact. */
export function validateLoRASafetensors(buffer: ArrayBuffer): LoRASafetensorsInfo {
  if (buffer.byteLength < 10) throw new Error('safetensors artifact is too small');
  const view = new DataView(buffer);
  const rawLength = view.getBigUint64(0, true);
  if (rawLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('safetensors header is too large');
  const headerLength = Number(rawLength);
  if (headerLength <= 2 || 8 + headerLength > buffer.byteLength) throw new Error('invalid safetensors header length');
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength))) as Record<string, unknown>;
  } catch {
    throw new Error('invalid safetensors JSON header');
  }
  const metadata = (header.__metadata__ && typeof header.__metadata__ === 'object' ? header.__metadata__ : {}) as Record<string, string>;
  const tensorNames = Object.keys(header).filter((name) => name !== '__metadata__');
  if (metadata.peft_type !== 'LORA') throw new Error('safetensors artifact is not a LoRA adapter');
  if (!tensorNames.some((name) => name.endsWith('.lora_A.weight'))) throw new Error('LoRA A tensor is missing');
  if (!tensorNames.some((name) => name.endsWith('.lora_B.weight'))) throw new Error('LoRA B tensor is missing');
  for (const name of tensorNames) {
    const tensor = header[name] as { data_offsets?: unknown };
    if (!Array.isArray(tensor?.data_offsets) || tensor.data_offsets.length !== 2) throw new Error(`invalid offsets for tensor ${name}`);
    const start = Number(tensor.data_offsets[0]);
    const end = Number(tensor.data_offsets[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || 8 + headerLength + end > buffer.byteLength) {
      throw new Error(`tensor ${name} exceeds artifact bounds`);
    }
  }
  return { metadata, tensorNames };
}
