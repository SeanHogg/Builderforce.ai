import * as ort from "onnxruntime-web/webgpu";
import { BUNDLE_IO } from "@webdit/shared";
import type { DitRunner, TextEncoderRunner, VaeRunner } from "./runners";
import type { MutableTensor } from "./types";

/** Wrap an ort.InferenceSession in a DitRunner. */
export class OrtDitRunner implements DitRunner {
  constructor(private readonly session: ort.InferenceSession) {}

  async run(latent: MutableTensor, t: number, textEmb: MutableTensor): Promise<MutableTensor> {
    const ts = new ort.Tensor("float32", new Float32Array([t]), [1]);
    const result = await this.session.run({
      [BUNDLE_IO.dit.inputs.latent]: toOrt(latent),
      [BUNDLE_IO.dit.inputs.timestep]: ts,
      [BUNDLE_IO.dit.inputs.textEmb]: toOrt(textEmb),
    });
    return fromOrt(result[BUNDLE_IO.dit.outputs.velocity] as ort.Tensor);
  }

  release(): Promise<void> {
    return this.session.release();
  }
}

export class OrtTextEncoderRunner implements TextEncoderRunner {
  constructor(private readonly session: ort.InferenceSession) {}

  async run(inputIds: BigInt64Array, attentionMask: BigInt64Array): Promise<MutableTensor> {
    const ids = new ort.Tensor("int64", inputIds, [1, inputIds.length]);
    const mask = new ort.Tensor("int64", attentionMask, [1, attentionMask.length]);
    const result = await this.session.run({
      [BUNDLE_IO.textEncoder.inputs.inputIds]: ids,
      [BUNDLE_IO.textEncoder.inputs.attentionMask]: mask,
    });
    return fromOrt(result[BUNDLE_IO.textEncoder.outputs.embeddings] as ort.Tensor);
  }

  release(): Promise<void> {
    return this.session.release();
  }
}

export class OrtVaeRunner implements VaeRunner {
  constructor(private readonly session: ort.InferenceSession) {}

  async run(latent: MutableTensor): Promise<Float32Array> {
    const result = await this.session.run({
      [BUNDLE_IO.vae.inputs.latent]: toOrt(latent),
    });
    return (result[BUNDLE_IO.vae.outputs.pixels] as ort.Tensor).data as Float32Array;
  }

  release(): Promise<void> {
    return this.session.release();
  }
}

function toOrt(t: MutableTensor): ort.Tensor {
  return new ort.Tensor("float32", t.data, [...t.dims]);
}

function fromOrt(t: ort.Tensor): MutableTensor {
  return { data: t.data as Float32Array, dims: t.dims };
}
