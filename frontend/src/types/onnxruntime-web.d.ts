/**
 * Minimal typings for `onnxruntime-web`.
 *
 * The package ships declarations at `types.d.ts` but its `exports` map has no
 * entry that resolves them, so `import('onnxruntime-web')` is implicitly `any`
 * under `moduleResolution: bundler` and trips `noImplicitAny`.
 *
 * Only one thing in this app imports the module directly — `voiceEngine.ts`,
 * to point the runtime at a host-served `.wasm` before the studio initialises —
 * so this declares exactly that surface instead of vendoring the package's full
 * API. Anything reaching for more of the runtime should go through
 * `@seanhogg/builderforce-studio`, which owns that integration.
 */
declare module 'onnxruntime-web' {
  export const env: {
    wasm: {
      /** Base URL (or per-file map) the runtime loads its `.wasm` from. */
      wasmPaths?: string | Record<string, string>;
      numThreads?: number;
      simd?: boolean;
    };
  };
}
