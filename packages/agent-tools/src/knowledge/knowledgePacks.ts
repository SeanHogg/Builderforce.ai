/**
 * The ONE pack list every host reviews and builds with. Order matters: memory's
 * ParserRegistry resolves the first parser that accepts a source, and the docs pack's
 * plain-text parser accepts anything textual, so the code pack must come first. Hosts call
 * this instead of composing the list themselves.
 */

import { DOCS_PACK, type KnowledgePack } from '@seanhogg/builderforce-memory/knowledge';
import { createCodePack, type CodePackDeps } from './codePack.js';

export function knowledgePacks(deps: CodePackDeps = {}): KnowledgePack[] {
    return [createCodePack(deps), DOCS_PACK];
}
