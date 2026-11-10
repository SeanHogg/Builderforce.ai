/**
 * The class band's composition and association links (PRD 43 B1a rule 9): `extends`, `implements`, `composes` and
 * `uses`, each a distinct style (tone + dash) of the ONE line shader — the house style table the Sequence's association
 * stubs read too. A drilled level draws them between the marks it shows: each end of a host relation
 * (`SymbolRecord.relations`, memory P0b) lands on the shown slot of its symbol, else of its file — so the class band
 * (a package's files) shows file → file associations and the method band (a file's symbols) shows class → class ones.
 * Never invented: only relations the host sent. Pure.
 */

import { fileRefOf } from '../../../surface/stations';
import type { ThemeTone } from '../../../scene/themeTokens';
import { toneIndex } from '../../../stage/tones';
import { DASH_CYCLE, DASH_DESCRIBES, DASH_SOLID, DASH_UNTESTED, type LinkBatch, type Placement } from '../../../stage/types';
import type { SymbolRecord } from '../../../types';
import { polylineBatch, type WorldPath } from './links';

export const ASSOCIATION_LINK_KINDS = ['extends', 'implements', 'composes', 'uses'] as const;
export type AssociationLinkKind = typeof ASSOCIATION_LINK_KINDS[number];

export const ASSOCIATION_STYLE: Readonly<Record<AssociationLinkKind, { tone: ThemeTone; dash: number }>> = {
    extends: { tone: 'text', dash: DASH_SOLID },
    implements: { tone: 'muted', dash: DASH_UNTESTED },
    composes: { tone: 'edge', dash: DASH_CYCLE },
    uses: { tone: 'muted', dash: DASH_DESCRIBES },
};

const WIDTH_PX = 1.25;
/** Associations drawn at most per level (the strongest are not ranked: the first the host sent). */
export const MAX_ASSOCIATIONS = 512;

const isKind = (k: string): k is AssociationLinkKind => (ASSOCIATION_LINK_KINDS as readonly string[]).includes(k);
const bare = (ref: string): string => ref.replace(/@\d+$/, '');

/**
 * The association links between the shown slots of `p`. `slotOfRef` names the slot a level station stands for, by the
 * ref of the node it draws (a symbol, or a file). Null when none connect two shown marks.
 */
export function associationLinks(p: Pick<Placement, 'position' | 'scale'>, records: readonly SymbolRecord[], slotOfRef: ReadonlyMap<string, number>): LinkBatch | null {
    const byBare = new Map<string, number>();
    for (const [ref, slot] of slotOfRef) if (!byBare.has(bare(ref))) byBare.set(bare(ref), slot);
    const shown = (slot: number | undefined): slot is number => slot !== undefined && (p.scale[slot] ?? 0) > 0;
    const end = (ref: string): number | undefined => {
        for (const s of [slotOfRef.get(ref), byBare.get(bare(ref)), slotOfRef.get(fileRefOf(ref))]) if (shown(s)) return s;
        return undefined;
    };
    const seen = new Set<string>();
    const paths: WorldPath[] = [];
    for (const r of records) {
        for (const rel of r.relations ?? []) {
            if (!isKind(rel.kind) || paths.length >= MAX_ASSOCIATIONS) continue;
            const a = end(r.ref), b = end(rel.to);
            if (a === undefined || b === undefined || a === b) continue;
            const key = `${rel.kind}\0${a}\0${b}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const style = ASSOCIATION_STYLE[rel.kind];
            const at = (s: number): [number, number, number] => [p.position[s * 3]!, p.position[s * 3 + 1]!, p.position[s * 3 + 2]!];
            paths.push({ pts: [at(a), at(b)], tone: toneIndex(style.tone), width: WIDTH_PX, dash: style.dash, flags: 0 });
        }
    }
    return paths.length ? polylineBatch('edge', paths, 'px') : null;
}
