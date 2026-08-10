import { describe, expect, it } from 'vitest';
import { validateLoRASafetensors } from './loraArtifact';

function artifact(header: Record<string, unknown>, payloadBytes = 8): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const bytes = new Uint8Array(8 + json.length + payloadBytes);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(json.length), true);
  bytes.set(json, 8);
  return bytes.buffer;
}

describe('validateLoRASafetensors', () => {
  it('accepts a bounded LoRA A/B adapter', () => {
    const result = validateLoRASafetensors(artifact({
      __metadata__: { peft_type: 'LORA', rank: '2' },
      'model.embed.lora_A.weight': { dtype: 'F16', shape: [2, 2], data_offsets: [0, 4] },
      'model.embed.lora_B.weight': { dtype: 'F16', shape: [2, 2], data_offsets: [4, 8] },
    }));
    expect(result.metadata.rank).toBe('2');
    expect(result.tensorNames).toHaveLength(2);
  });

  it('rejects non-LoRA and out-of-bounds artifacts', () => {
    expect(() => validateLoRASafetensors(artifact({ __metadata__: { peft_type: 'FULL' } }))).toThrow(/not a LoRA/i);
    expect(() => validateLoRASafetensors(artifact({
      __metadata__: { peft_type: 'LORA' },
      'x.lora_A.weight': { data_offsets: [0, 4] },
      'x.lora_B.weight': { data_offsets: [4, 999] },
    }))).toThrow(/bounds/i);
  });
});
