import * as path from "node:path";
import type { WebDiTManifest, WebDiTQuantization } from "@webdit/shared";
import { writeBundle } from "./bundle-writer";
import { quantize, type QuantizedTensor } from "./quantize";
import { readSafetensors, type SafetensorsTensor } from "./safetensors";
import type { ArchitectureAdapter } from "./architectures/base";

export interface ConvertOptions {
  source: string;
  output: string;
  quantization: WebDiTQuantization;
  shardLimitBytes?: number;
}

export async function convert(
  adapter: ArchitectureAdapter,
  opts: ConvertOptions,
): Promise<WebDiTManifest> {
  const layout = adapter.expectedSourceLayout();
  const resolve = (p: string) => path.join(opts.source, p);

  const [ditTensors, teTensors, vaeTensors] = await Promise.all([
    readSafetensors(resolve(layout.ditWeights)),
    readSafetensors(resolve(layout.textEncoderWeights)),
    readSafetensors(resolve(layout.vaeWeights)),
  ]);

  const ditWeights = quantizeAll(ditTensors, opts.quantization);
  const textEncoderWeights = quantizeAll(teTensors, opts.quantization);
  const vaeWeights = quantizeAll(vaeTensors, opts.quantization);

  return writeBundle({
    output: opts.output,
    manifest: adapter.buildManifest(opts.quantization),
    ditWeights,
    textEncoderWeights,
    vaeWeights,
    graphs: {
      dit: resolve(layout.ditGraph),
      textEncoder: resolve(layout.textEncoderGraph),
      vae: resolve(layout.vaeGraph),
    },
    tokenizerDir: resolve(layout.tokenizerDir),
    shardLimitBytes: opts.shardLimitBytes,
  });
}

function quantizeAll(
  tensors: SafetensorsTensor[],
  mode: WebDiTQuantization,
): Map<string, QuantizedTensor> {
  const out = new Map<string, QuantizedTensor>();
  for (const t of tensors) out.set(t.name, quantize(t.data, t.shape, mode));
  return out;
}
