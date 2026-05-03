import type { MLCEngine } from "@mlc-ai/web-llm";
import { loadBundle, type LoadedBundle } from "./bundle";
import { runDenoiseLoop } from "./ort-runner";
import type { VideoGenerateRequest, VideoGenerateResult } from "./types";

export interface VideoNamespace {
  generate(req: VideoGenerateRequest): Promise<VideoGenerateResult>;
  unload(): Promise<void>;
}

export interface WebDiTEngineOptions {
  /** Root URL of the bundle (where manifest.json lives). */
  bundleUrl: string;
}

export type WithVideo<E> = E & { video: VideoNamespace };

/**
 * Attach a `.video` namespace to an existing WebLLM MLCEngine. Single engine
 * object, both LLM (`engine.chat.completions.create`) and DiT video
 * (`engine.video.generate`). No fork of WebLLM, no proxy.
 */
export async function withVideo<E extends MLCEngine>(
  engine: E,
  opts: WebDiTEngineOptions,
): Promise<WithVideo<E>> {
  const bundle = await loadBundle(opts.bundleUrl);
  attachVideoNamespace(engine, bundle);
  return engine as WithVideo<E>;
}

function attachVideoNamespace(engine: MLCEngine, bundle: LoadedBundle): void {
  (engine as WithVideo<MLCEngine>).video = {
    generate: (req) => runDenoiseLoop(bundle, req),
    unload: () => bundle.unload(),
  };
}
