/**
 * The co-change partners as a list (PRD 38 P4), one line per partner with its confidence worded by `rateFormat`: ONE
 * component for "What changed?", the fix flow's tests check and "This path is done when…". No history ⇒ "Not set up".
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../labels';
import { partnerName, type Partners } from './coChange';
import { rateFormat } from './rateFormat';
import { TYPE } from './ui/type';

export interface PartnerListProps {
    partners: Partners;
    labels: KnowledgeGraphLabels;
    /** One line: `{name}`, `{rate}`. */
    template: string;
    /** Said when there is history but no partner is left. */
    none: string;
}

export function PartnerList({ partners, labels, template, none }: PartnerListProps) {
    if (partners === null) return <p data-partners="not-set-up" style={{ ...TYPE.bodyMuted, margin: 0 }}>{labels.surface.notSetUp}</p>;
    if (partners.length === 0) return <p data-partners="none" style={{ ...TYPE.bodyMuted, margin: 0 }}>{none}</p>;
    return (
        <ul data-partners="list" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4, minWidth: 0 }}>
            {partners.map((p) => (
                <li key={p.ref} data-partner={p.ref} style={{ ...TYPE.body, overflowWrap: 'anywhere' }}>
                    {fillTemplate(template, { name: partnerName(p.ref), rate: rateFormat(labels, { k: p.together, n: p.ofSelf, low: p.low, high: p.high }) })}
                </li>
            ))}
        </ul>
    );
}
