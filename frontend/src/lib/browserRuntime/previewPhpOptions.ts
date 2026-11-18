/**
 * The PHP the preview runtime's PHP processes run (php-wasm, from jsDelivr) — ONE object,
 * given to the runtime (`previewRuntime.ts`), to the run target's `php` provider, and to the
 * browser acceptance check (`runTarget/browserAcceptance.ts`), so every check judges the
 * same PHP the processes run. Its own light module (a type-only import), so the acceptance
 * path reads it without pulling the runtime in. Python needs no options: Pyodide comes from
 * jsDelivr's absolute, CORS-served URL, which relay mode requires.
 */
import type { PhpHostOptions } from '@seanhogg/builderforce-webcontainers/app';

export const PREVIEW_PHP_OPTIONS: PhpHostOptions = { phpVersion: '8.3' };
