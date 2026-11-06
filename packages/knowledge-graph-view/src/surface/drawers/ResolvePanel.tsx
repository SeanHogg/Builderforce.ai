/**
 * The Resolve drawer: the finding chosen with *Resolve*, where it comes from, and the staged
 * fix flow that closes it (`fix/FixFlowView`: Apply to branch, Run checks, Mark resolved, Undo).
 * Every step runs through a source port when the host has one and goes to the agent through the
 * composer when it does not, so no step is a dead button.
 */

import { useMemo } from 'react';
import { findingRequest, findingTitle } from '../../findingText';
import { nodeIndex } from '../../graphModel';
import { fillTemplate } from '../../labels';
import { button, card, heading, muted } from '../../styles';
import { ProvenanceBadge } from '../ui';
import { FixFlowView } from '../fix/FixFlowView';
import { findingProvenance, scopeFindings } from '../scope';
import { stationOfRef } from '../stations';
import type { PanelProps } from '../registry';
import { Section } from './ui';

export function ResolvePanel({ graph, labels, surface, source, revision, onShow, onCompose, onChanged }: PanelProps) {
    const t = labels.surface.resolve;
    const finding = surface.resolving;
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const queue = useMemo(() => scopeFindings(graph.findings, surface.stations, surface.scope), [graph.findings, surface.stations, surface.scope]);
    if (!finding) return <p style={{ ...muted, margin: 0 }}>{t.empty}</p>;

    const stations = new Set(finding.nodes.flatMap((r) => stationOfRef(surface.stations, r) ?? []));

    return (
        <div data-testid="kg-resolve" style={{ display: 'grid', gap: 16 }}>
            <section style={{ ...card, display: 'grid', gap: 6 }}>
                <h3 style={heading}>{findingTitle(finding, labels)}</h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={muted}>{t.provenanceLabel}</span>
                    <ProvenanceBadge provenance={findingProvenance(finding)} labels={labels} />
                </div>
                <p style={{ ...muted, margin: 0 }}>{findingRequest(finding, labels, index)}</p>
                <div><button type="button" style={button} onClick={() => onShow([...finding.nodes])}>{t.show}</button></div>
            </section>

            <FixFlowView key={finding.id} finding={finding} graph={graph} labels={labels} source={source} onCompose={onCompose} onChanged={onChanged} queue={queue} revision={revision} surface={surface} />

            <Section title={t.checksTitle}>
                <ul style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4, fontSize: 13 }}>
                    <li>{fillTemplate(t.checkFiles, { count: finding.nodes.length })}</li>
                    <li>{fillTemplate(t.checkStations, { count: stations.size })}</li>
                    <li>{t.checkReview}</li>
                </ul>
            </Section>
        </div>
    );
}
