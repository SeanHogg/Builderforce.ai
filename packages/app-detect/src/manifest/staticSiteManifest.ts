/**
 * The manifest of a plain static site (HTML, CSS, JS beside it: no `package.json`, no
 * build): ONE frontend whose `vite` command the runtime answers with its own in-browser
 * dev server (the same instant preview a Vite project gets), serving the directory.
 * Detection recognises nothing in such a folder, so a host that launches one (the VS Code
 * `/launch <page>`) writes this, through `emitManifest` like every other manifest.
 */

import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';
import { buildBlueprint } from '../detectApp';
import { emitManifest, type EmitManifestResult } from './emitManifest';

/** The command the runtime hands off to its in-browser dev server (it needs no install). */
export const STATIC_SITE_COMMAND = 'vite';

export function emitStaticSiteManifest(name?: string): EmitManifestResult {
  const blueprint = buildBlueprint({
    services: [{
      id: 'web',
      kind: SERVICE_KINDS.SPA,
      rootDir: '.',
      packageManager: 'npm',
      installCommand: '',
      devCommand: STATIC_SITE_COMMAND,
      buildCommand: '',
      startCommand: '',
      verifyCommand: null,
      outputDir: null,
      ports: [],
      envVars: [],
      isPrimary: true,
    }],
  }, 0, '');
  return emitManifest(blueprint, name ? { name } : {});
}
