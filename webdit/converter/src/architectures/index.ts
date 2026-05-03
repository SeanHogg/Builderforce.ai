import type { WebDiTArchitecture } from "@webdit/shared";
import type { ArchitectureAdapter } from "./base";
import { ltx2Distilled } from "./ltx";

const REGISTRY: Record<WebDiTArchitecture, ArchitectureAdapter | undefined> = {
  "ltx2-distilled": ltx2Distilled,
  "wan2.5": undefined,
  "mochi-1": undefined,
  "cogvideox-2b": undefined,
};

export function getAdapter(id: string): ArchitectureAdapter {
  const adapter = REGISTRY[id as WebDiTArchitecture];
  if (!adapter) {
    throw new Error(
      `Unknown or not-yet-supported architecture '${id}'. Known: ${listArchitectures().join(", ")}`,
    );
  }
  return adapter;
}

export function listArchitectures(): string[] {
  return Object.entries(REGISTRY)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
    .sort();
}

export type { ArchitectureAdapter, SourceLayout } from "./base";
