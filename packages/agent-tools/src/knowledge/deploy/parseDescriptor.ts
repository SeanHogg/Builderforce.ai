/**
 * knowledge/deploy/parseDescriptor.ts — THE dispatch from a descriptor file to its deployable units: the path picks
 * the family ({@link descriptorKindOf}), the family's pure parser reads the text. Never throws: a descriptor its
 * parser cannot read gives no units. Pure.
 */

import { parseCompose } from './compose.js';
import { descriptorKindOf, type DescriptorKind, type DeployUnit } from './deployModel.js';
import { parseDockerfile } from './dockerfileUnits.js';
import { parseFlyToml } from './flyToml.js';
import { parseKubernetes } from './kubernetes.js';
import { parsePackageJson } from './packageJson.js';
import { parseProcfile } from './procfile.js';
import { parseServerless } from './serverless.js';
import { parseVercel } from './vercel.js';
import { parseWorkflow } from './workflows.js';
import { parseWrangler } from './wrangler.js';

export interface ParsedDescriptor {
    kind: DescriptorKind;
    units: DeployUnit[];
    /** package.json only: its `workspaces` globs. */
    workspaces?: string[];
}

const PARSERS: Record<Exclude<DescriptorKind, 'package'>, (path: string, text: string) => DeployUnit[]> = {
    dockerfile: parseDockerfile,
    compose: parseCompose,
    wrangler: parseWrangler,
    kubernetes: parseKubernetes,
    procfile: parseProcfile,
    fly: parseFlyToml,
    vercel: parseVercel,
    serverless: parseServerless,
    workflow: parseWorkflow,
};

/** Largest descriptor read, in UTF-16 code units (~256 KB): a bigger one is generated or vendored, and gives no units. */
export const MAX_DESCRIPTOR_CHARS = 256 * 1024;

/** The units `path` declares; undefined when `path` is no deploy descriptor. */
export function parseDescriptor(path: string, text: string): ParsedDescriptor | undefined {
    const kind = descriptorKindOf(path);
    if (!kind) return undefined;
    if (text.length > MAX_DESCRIPTOR_CHARS) return { kind, units: [] };
    try {
        if (kind === 'package') {
            const { units, workspaces } = parsePackageJson(path, text);
            return { kind, units, ...(workspaces.length > 0 ? { workspaces } : {}) };
        }
        return { kind, units: PARSERS[kind](path, text) };
    } catch {
        return { kind, units: [] };
    }
}
