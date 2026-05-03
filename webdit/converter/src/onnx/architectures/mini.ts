import { GraphBuilder } from "../builder";
import { TensorDataType } from "../types";

/**
 * ONNX graphs for the `mini-test` architecture. These are the production
 * counterpart to runners-mini.ts in the runtime — same math, expressed as
 * ONNX ops so ORT-Web can run them.
 *
 * Math summary (all backends compute the same thing):
 *   DiT:     velocity[c, ...] = latent[c, ...] * scale[c] + bias[c]
 *   TextEnc: text_emb[l, :]   = proj[input_ids[l], :]
 *   VAE:     pixels[c, ...]   = tanh( resize_nearest( conv1x1x1(latent, proj) ) )
 *
 * Inputs/outputs use the BUNDLE_IO names from @webdit/shared so the runtime's
 * Ort runners can call session.run() against these graphs unchanged.
 */

export interface MiniGraphWeights {
  ditScale: Float32Array; // [4]
  ditBias: Float32Array; // [4]
  teProj: Float32Array; // [vocab, embedDim]
  vaeProj: Float32Array; // [3, 4]
}

export function buildMiniDitGraph(scale: Float32Array, bias: Float32Array): Uint8Array {
  if (scale.length !== 4 || bias.length !== 4) {
    throw new Error(`buildMiniDitGraph: expected scale/bias length 4, got ${scale.length}/${bias.length}`);
  }
  const b = new GraphBuilder();
  b.input("latent", TensorDataType.FLOAT, [1, 4, "T", "H", "W"]);
  b.input("timestep", TensorDataType.FLOAT, [1]);
  b.input("text_emb", TensorDataType.FLOAT, [1, "L", 8]);
  b.output("velocity", TensorDataType.FLOAT, [1, 4, "T", "H", "W"]);
  // Broadcast scale/bias across [B, C, T, H, W] by reshaping to [1, 4, 1, 1, 1].
  b.initF32("scale", scale, [1, 4, 1, 1, 1]);
  b.initF32("bias", bias, [1, 4, 1, 1, 1]);
  b.node("Mul", ["latent", "scale"], ["scaled"]);
  b.node("Add", ["scaled", "bias"], ["velocity"]);
  return b.build("dit");
}

export function buildMiniTextEncoderGraph(
  proj: Float32Array,
  vocab: number,
  embedDim: number,
): Uint8Array {
  if (proj.length !== vocab * embedDim) {
    throw new Error(
      `buildMiniTextEncoderGraph: proj length ${proj.length} != vocab*embedDim ${vocab * embedDim}`,
    );
  }
  const b = new GraphBuilder();
  b.input("input_ids", TensorDataType.INT64, [1, "L"]);
  b.input("attention_mask", TensorDataType.INT64, [1, "L"]);
  b.output("text_emb", TensorDataType.FLOAT, [1, "L", embedDim]);
  b.initF32("proj_table", proj, [vocab, embedDim]);
  b.node("Gather", ["proj_table", "input_ids"], ["text_emb"], [b.intAttr("axis", 0)]);
  return b.build("text_encoder");
}

export function buildMiniVaeGraph(
  proj: Float32Array,
  spatialFactor: number,
  temporalFactor: number,
): Uint8Array {
  if (proj.length !== 12) {
    throw new Error(`buildMiniVaeGraph: vae.proj must be [3, 4]=12 elements, got ${proj.length}`);
  }
  const b = new GraphBuilder();
  b.input("latent", TensorDataType.FLOAT, [1, 4, "T", "H", "W"]);
  b.output("pixels", TensorDataType.FLOAT, [1, 3, "T_out", "H_out", "W_out"]);
  // Conv kernel: [out_channels=3, in_channels=4, kD=1, kH=1, kW=1]
  b.initF32("conv_w", proj, [3, 4, 1, 1, 1]);
  b.node("Conv", ["latent", "conv_w"], ["projected"], [
    b.intsAttr("kernel_shape", [1, 1, 1]),
  ]);
  // Resize requires 2 sentinel inputs (roi, scales) + sizes optional in opset 13+.
  b.initF32("roi", new Float32Array(0), [0]);
  b.initF32(
    "scales",
    new Float32Array([1, 1, temporalFactor, spatialFactor, spatialFactor]),
    [5],
  );
  b.node("Resize", ["projected", "roi", "scales"], ["upsampled"], [
    b.stringAttr("mode", "nearest"),
    b.stringAttr("coordinate_transformation_mode", "asymmetric"),
    b.stringAttr("nearest_mode", "floor"),
  ]);
  b.node("Tanh", ["upsampled"], ["pixels"]);
  return b.build("vae");
}

export function renderMiniGraphs(
  w: MiniGraphWeights,
  vocab: number,
  embedDim: number,
  spatialFactor: number,
  temporalFactor: number,
): { dit: Uint8Array; textEncoder: Uint8Array; vae: Uint8Array } {
  return {
    dit: buildMiniDitGraph(w.ditScale, w.ditBias),
    textEncoder: buildMiniTextEncoderGraph(w.teProj, vocab, embedDim),
    vae: buildMiniVaeGraph(w.vaeProj, spatialFactor, temporalFactor),
  };
}
