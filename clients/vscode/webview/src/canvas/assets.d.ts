/// <reference types="@webgpu/types" />

/**
 * Ambient declarations for the canvas project.
 *
 * WebGPU: `lib.dom.d.ts` declares the WebGPU *types* but not the value globals
 * (`GPUBufferUsage`, `GPUMapMode`) that `mamba-engine.ts` uses. The frontend
 * picks those up from its own dependency tree; this project resolves types from
 * the extension's tree instead, so it states the dependency explicitly.
 *
 * Asset modules: on the web these come from Next (`next-env.d.ts` →
 * `next/types`), which the canvas bundle does not use. Vite understands them
 * natively at build time; TypeScript just needs to be told they are modules, or
 * every `import styles from './X.module.css'` in the compiled frontend
 * components is a type error even though the bundle builds correctly.
 */

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

declare module '*.css';
declare module '*.svg' {
  const src: string;
  export default src;
}
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
declare module '*.webp' {
  const src: string;
  export default src;
}
