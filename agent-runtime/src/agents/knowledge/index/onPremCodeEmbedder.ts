import { homedir } from "node:os";
import { join } from "node:path";
import {
  cachedBgeSnapshot,
  loadBgeCodeEmbedder,
  workspaceCodeEmbedder,
  type EmbedderPort,
  type LoadBgePipeline,
} from "@seanhogg/builderforce-code-index";
import { createSubsystemLogger } from "../../../logging/subsystem.js";

const log = createSubsystemLogger("workspace/code-search");
let localModel: Promise<EmbedderPort | undefined> | undefined;

async function loadLocalModel(): Promise<EmbedderPort | undefined> {
  const desktopHome = process.env.BUILDERFORCE_DESKTOP_HOME?.trim() || join(homedir(), ".builderforce", "desktop");
  const snapshot = await cachedBgeSnapshot(join(desktopHome, "models"));
  if (!snapshot) return undefined;
  const { pipeline } = await import("@huggingface/transformers");
  // Restrict the upstream overload to the feature-extraction task this adapter uses.
  const load = pipeline as unknown as LoadBgePipeline;
  return (await loadBgeCodeEmbedder(snapshot, load)).port;
}

/** Prefer the local BGE checkpoint when installed. Both workspace entry points share its inference session. */
export async function onPremCodeEmbedder(): Promise<EmbedderPort | undefined> {
  localModel ??= loadLocalModel().catch((error: unknown) => {
    log.debug(`Local BGE code embedder unavailable: ${String(error)}`);
    return undefined;
  });
  return (await localModel) ?? workspaceCodeEmbedder();
}
