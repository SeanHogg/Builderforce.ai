import type { WebDiTArchitecture } from "@webdit/shared";
import type { ArchitectureAdapter } from "./base";
import { cogvideox2b } from "./cogvideox";
import { ltx2Distilled } from "./ltx";
import { miniTest } from "./mini";
import { mochi1 } from "./mochi";
import { wan25 } from "./wan";

const REGISTRY: Record<WebDiTArchitecture, ArchitectureAdapter> = {
  "ltx2-distilled": ltx2Distilled,
  "wan2.5": wan25,
  "mochi-1": mochi1,
  "cogvideox-2b": cogvideox2b,
  "mini-test": miniTest,
};

export function getAdapter(id: string): ArchitectureAdapter {
  const adapter = REGISTRY[id as WebDiTArchitecture];
  if (!adapter) {
    throw new Error(
      `Unknown architecture '${id}'. Known: ${listArchitectures().join(", ")}`,
    );
  }
  return adapter;
}

export function listArchitectures(): string[] {
  return Object.keys(REGISTRY).sort();
}

export type { ArchitectureAdapter, SourceLayout } from "./base";
export {
  diffusersSourceLayout,
  defaultBundleFiles,
  buildManifestWith,
  type ArchitectureSpec,
} from "./defaults";
