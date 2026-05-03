import type {
  SchedulerKind,
  TextEncoderKind,
  WebDiTArchitecture,
  WebDiTManifest,
  WebDiTQuantization,
} from "./index";

export const KNOWN_ARCHITECTURES: ReadonlyArray<WebDiTArchitecture> = [
  "ltx2-distilled",
  "wan2.5",
  "mochi-1",
  "cogvideox-2b",
];

export const KNOWN_QUANTIZATIONS: ReadonlyArray<WebDiTQuantization> = [
  "q4f16_1",
  "q8f16_0",
  "f16",
];

export const KNOWN_SCHEDULERS: ReadonlyArray<SchedulerKind> = [
  "flow-match-rect",
  "euler",
  "dpm++-2m",
];

export const KNOWN_TEXT_ENCODERS: ReadonlyArray<TextEncoderKind> = [
  "clip-l",
  "t5-base",
  "t5-xxl",
];

/**
 * Defensive runtime validator for a parsed-but-untyped manifest. Throws
 * an Error pinpointing the bad path on failure; returns the value as a
 * properly-typed WebDiTManifest on success.
 *
 * Used at both ends of the pipeline: bundle loader before trusting the JSON,
 * bundle writer before serializing it. Catching mismatches at write time is
 * cheap; catching them in the browser after a multi-GB download is not.
 */
export function validateManifest(value: unknown): WebDiTManifest {
  assertObject(value, "manifest");
  assertEqual(value.bundleVersion, 1, "manifest.bundleVersion");
  assertOneOf(value.architecture, KNOWN_ARCHITECTURES, "manifest.architecture");
  assertOneOf(value.quantization, KNOWN_QUANTIZATIONS, "manifest.quantization");
  assertOneOf(value.scheduler, KNOWN_SCHEDULERS, "manifest.scheduler");

  assertObject(value.latentShape, "manifest.latentShape");
  for (const k of ["c", "t", "h", "w"] as const) {
    assertNumber(value.latentShape[k], `manifest.latentShape.${k}`);
  }

  assertObject(value.vaeCompression, "manifest.vaeCompression");
  for (const k of ["spatial", "temporal"] as const) {
    assertNumber(value.vaeCompression[k], `manifest.vaeCompression.${k}`);
  }

  assertObject(value.patchSize, "manifest.patchSize");
  for (const k of ["d", "h", "w"] as const) {
    assertNumber(value.patchSize[k], `manifest.patchSize.${k}`);
  }

  assertObject(value.textEncoder, "manifest.textEncoder");
  assertOneOf(value.textEncoder.kind, KNOWN_TEXT_ENCODERS, "manifest.textEncoder.kind");
  assertNumber(value.textEncoder.maxTokens, "manifest.textEncoder.maxTokens");
  assertNumber(value.textEncoder.embedDim, "manifest.textEncoder.embedDim");

  assertObject(value.defaults, "manifest.defaults");
  for (const k of ["steps", "guidanceScale", "frames", "height", "width"] as const) {
    assertNumber(value.defaults[k], `manifest.defaults.${k}`);
  }

  assertObject(value.files, "manifest.files");
  for (const k of [
    "ditGraph",
    "textEncoderGraph",
    "textEncoderWeights",
    "vaeGraph",
    "vaeWeights",
    "tokenizer",
  ] as const) {
    assertString(value.files[k], `manifest.files.${k}`);
  }
  assertArray(value.files.ditWeightShards, "manifest.files.ditWeightShards");
  for (let i = 0; i < value.files.ditWeightShards.length; i++) {
    assertString(value.files.ditWeightShards[i], `manifest.files.ditWeightShards[${i}]`);
  }

  return value as unknown as WebDiTManifest;
}

function assertObject(v: unknown, path: string): asserts v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(`${path}: expected object, got ${describe(v)}`);
  }
}

function assertString(v: unknown, path: string): asserts v is string {
  if (typeof v !== "string") {
    throw new Error(`${path}: expected string, got ${describe(v)}`);
  }
}

function assertNumber(v: unknown, path: string): asserts v is number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`${path}: expected finite number, got ${describe(v)}`);
  }
}

function assertArray(v: unknown, path: string): asserts v is unknown[] {
  if (!Array.isArray(v)) {
    throw new Error(`${path}: expected array, got ${describe(v)}`);
  }
}

function assertEqual<T>(v: unknown, expected: T, path: string): asserts v is T {
  if (v !== expected) {
    throw new Error(`${path}: expected ${JSON.stringify(expected)}, got ${describe(v)}`);
  }
}

function assertOneOf<T extends string>(
  v: unknown,
  allowed: readonly T[],
  path: string,
): asserts v is T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new Error(`${path}: expected one of ${allowed.join(", ")}, got ${describe(v)}`);
  }
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
