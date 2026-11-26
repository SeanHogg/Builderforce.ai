/**
 * "See it restructured" on a Patterns card (PRD 43 Part C6): it opens the compare on the finding's proposal, the picture of
 * that card (it is not a second preview). Shown only for a kind that has a proposer (`isRestructurable`) and only where the
 * host view provides the action (`RestructureContext`), so a card drawn elsewhere has no dead button.
 */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { isRestructurable } from '../../compute/compare';
import type { KnowledgeGraphLabels } from '../../labels';
import { button } from '../../styles';
import { useRestructureAction } from '../useRestructure';

export function SeeRestructured({ finding, labels }: { finding: Finding; labels: KnowledgeGraphLabels }) {
    const restructure = useRestructureAction();
    if (!restructure || !isRestructurable(finding.kind)) return null;
    return (
        <button type="button" data-action="see-restructured" style={{ ...button, borderRadius: 8 }} onClick={() => restructure(finding)}>
            {labels.surface.compare.seeRestructured}
        </button>
    );
}
