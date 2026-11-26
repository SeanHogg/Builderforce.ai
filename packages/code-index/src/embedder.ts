import { ollamaEmbedderSource } from "@builderforce/local-inference";
import type { EmbedderPort } from "@seanhogg/builderforce-memory/knowledge";

const local = ollamaEmbedderSource(
  (url, options) => fetch(url, { ...options, redirect: "error" }),
  { baseUrl: "http://127.0.0.1:11434" },
);

/** Both Workspace hosts use the same loopback-only, already-resident model policy. */
export async function workspaceCodeEmbedder(): Promise<EmbedderPort | undefined> {
  return local.warm() ? await local.port() : undefined;
}
