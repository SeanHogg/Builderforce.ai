/**
 * rules/support/scripts.ts — what counts as a "script" for the C7 safety rules: shell files, anything
 * under a `scripts/` directory, GitHub workflows, package manifests, Makefiles and Dockerfiles.
 */

import { isShellPath } from '@builderforce/agent-tools/code-mask';

export function isScriptPath(path: string): boolean {
    return isShellPath(path)
        || /(^|\/)scripts\//.test(path)
        || /(^|\/)\.github\/workflows\//.test(path)
        || /(^|\/)package\.json$/.test(path)
        || /(^|\/)(?:Makefile|Dockerfile)(?:\.[\w-]+)?$/.test(path);
}
