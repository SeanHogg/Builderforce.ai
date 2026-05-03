import type { WebDiTArchitecture, WebDiTManifest, WebDiTQuantization } from "@webdit/shared";

/** Paths within the source dir where the converter looks for inputs. */
export interface SourceLayout {
  ditWeights: string;
  textEncoderWeights: string;
  vaeWeights: string;
  ditGraph: string;
  textEncoderGraph: string;
  vaeGraph: string;
  tokenizerDir: string;
}

export interface ArchitectureAdapter {
  readonly id: WebDiTArchitecture;
  /** Where this architecture's source files live, relative to the source dir. */
  expectedSourceLayout(): SourceLayout;
  /** Build a manifest. Shard paths are rewritten by the bundle writer; caller-supplied count is informational. */
  buildManifest(quantization: WebDiTQuantization): WebDiTManifest;
}
