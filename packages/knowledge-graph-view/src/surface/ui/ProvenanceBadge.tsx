/** Where a number or a finding comes from (deterministic, heuristic, runtime): one outlined chip. */

import type { KnowledgeGraphLabels } from '../../labels';
import type { ThemeTone } from '../../scene/themeColors';
import type { Provenance } from '../layers';
import { Chip } from './Chip';

const PROVENANCE_TONE: Record<Provenance, ThemeTone> = { deterministic: 'agrees', heuristic: 'cycle', runtime: 'accent' };

export function ProvenanceBadge({ provenance, labels }: { provenance: Provenance; labels: KnowledgeGraphLabels }) {
    return <Chip tone={PROVENANCE_TONE[provenance]} data-provenance={provenance}>{labels.surface.provenance[provenance]}</Chip>;
}
