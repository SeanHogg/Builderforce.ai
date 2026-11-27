import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EmbedderPort } from "@seanhogg/builderforce-memory/knowledge";

export const CODE_EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const CODE_EMBEDDING_DIMENSIONS = 384;

export async function cachedBgeSnapshot(cache: string): Promise<string | undefined> {
  const root = join(cache, `models--${CODE_EMBEDDING_MODEL.replace("/", "--")}`);
  try {
    const revision = (await readFile(join(root, "refs", "main"), "utf8")).trim();
    if (!/^[a-f0-9]{40}$/i.test(revision)) throw new Error("Invalid BGE checkpoint revision");
    return join(root, "snapshots", revision);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

interface BgePipeline {
  (texts: string[], options: { pooling: "cls"; normalize: true }): Promise<{ tolist(): number[][] }>;
  dispose(): Promise<void>;
}

export type LoadBgePipeline = (
  task: "feature-extraction",
  snapshot: string,
  options: { local_files_only: true; device: "cpu"; dtype: "fp32" },
) => Promise<BgePipeline>;

/** Load the same local checkpoint and pooling used by the native code index. */
export async function loadBgeCodeEmbedder(snapshot: string, load: LoadBgePipeline): Promise<{
  port: EmbedderPort;
  checkpointSha256: string;
  dispose(): Promise<void>;
}> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(snapshot, "onnx", "model.onnx"))) hash.update(chunk);
  const checkpointSha256 = hash.digest("hex");
  const model = await load("feature-extraction", snapshot, { local_files_only: true, device: "cpu", dtype: "fp32" });
  return {
    checkpointSha256,
    dispose: () => model.dispose(),
    port: {
      fingerprint: `${CODE_EMBEDDING_MODEL}:fp32:cls:${checkpointSha256}`,
      dims: CODE_EMBEDDING_DIMENSIONS,
      async embed(texts) {
        const output = await model([...texts], { pooling: "cls", normalize: true });
        return output.tolist().map((row) => Float32Array.from(row));
      },
    },
  };
}
