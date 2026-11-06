/**
 * The API drawer: the endpoints read from the `routes` badge, split into "in contract" and
 * "undocumented" (an OpenAPI document in the graph names the path), each grouped by the file that
 * registers it. The list is the master: choosing a row selects the endpoint, and ONE card shows its
 * KPIs, parameters, whether a test file references the handler, who calls it (chips that select the
 * caller on the map) and the sandbox (*Send* where the host offers `tryRequest`, Copy as curl always).
 * The OpenAPI skeleton and Postman collection are generated here and downloaded; *Contract tests*
 * hands the composer the endpoints ticked in the list. With no OpenAPI document every endpoint is
 * undocumented and a note says the contract is missing.
 */

import { useMemo, useState } from 'react';
import { fillTemplate } from '../../labels';
import { button, heading, muted, primaryButton } from '../../styles';
import type { PanelProps } from '../registry';
import { ApiEndpointRow } from './ApiEndpointRow';
import { endpointKey, referrersOf, selected, splitContract } from './apiDetail';
import { endpointsOf, groupByFile, openApiDocs, openApiSkeleton, postmanCollection, requestLine, type Endpoint } from './apiModel';
import { downloadJson } from './download';
import { ApiEndpointCard } from './ApiEndpointCard';
import { Kpi, kpiGrid, NotSetUp, Unavailable } from './ui';

const MAX_TEST_ROUTES = 20;

export function ApiPanel({ graph, labels, surface, rootTitle, onCompose, onShow, source }: PanelProps) {
    const t = labels.surface.api;
    const endpoints = useMemo(() => endpointsOf(graph, surface.stations), [graph, surface.stations]);
    const split = useMemo(() => splitContract(endpoints), [endpoints]);
    const referrers = useMemo(() => referrersOf(graph), [graph]);
    const hasContract = useMemo(() => openApiDocs(graph.nodes).length > 0, [graph.nodes]);
    // One stable function per source, so the sandbox's send hook does not re-create on every render.
    const tryRequest = useMemo(() => (source?.tryRequest ? source.tryRequest.bind(source) : undefined), [source]);
    const [failed, setFailed] = useState(false);
    const [active, setActive] = useState<string | null>(null);
    // Every endpoint starts in the contract tests; the person unticks the ones to leave out.
    const [off, setOff] = useState<ReadonlySet<string>>(new Set());
    if (endpoints.length === 0) return <NotSetUp title={t.notSetUpTitle} body={t.notSetUpBody} />;
    const activeEndpoint = endpoints.find((e) => endpointKey(e) === active) ?? endpoints[0]!;
    const chosen = selected(endpoints, new Set(endpoints.map(endpointKey).filter((k) => !off.has(k))));
    const undocumented = split.undocumented.length;
    const title = rootTitle ?? graph.scope.rootId;
    const save = (name: string, value: unknown) => setFailed(!downloadJson(name, value));
    const toggle = (key: string) => setOff((cur) => { const next = new Set(cur); if (!next.delete(key)) next.add(key); return next; });

    const bucket = (list: readonly Endpoint[], heading3: string, kind: 'contract' | 'undocumented') => list.length === 0 ? null : (
        <section key={kind} data-bucket={kind} style={{ display: 'grid', gap: 10 }}>
            <h3 style={heading}>{heading3}</h3>
            {groupByFile(list).map((g) => (
                <section key={g.file} aria-label={fillTemplate(t.groupAria, { file: g.fileName, count: g.endpoints.length })} style={{ display: 'grid', gap: 6 }}>
                    <h4 style={{ ...heading, fontSize: 12, overflowWrap: 'anywhere' }}>{g.fileName}</h4>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                        {g.endpoints.map((e, i) => (
                            <ApiEndpointRow
                                key={`${g.file}|${requestLine(e)}|${i}`} endpoint={e} labels={labels} active={endpointKey(e) === endpointKey(activeEndpoint)}
                                included={!off.has(endpointKey(e))} onToggle={() => toggle(endpointKey(e))} onSelect={() => setActive(endpointKey(e))}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </section>
    );

    return (
        <div data-testid="kg-api" style={{ display: 'grid', gap: 16 }}>
            <div style={kpiGrid}>
                <Kpi label={t.kpiEndpoints} value={endpoints.length} />
                <Kpi label={t.kpiUndocumented} value={undocumented} tone={undocumented > 0 ? 'cycle' : 'agrees'} />
            </div>
            {!hasContract && <p role="status" data-testid="kg-api-contract" style={{ ...muted, margin: 0 }}>{t.contractMissing}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" style={button} onClick={() => save('openapi.skeleton.json', openApiSkeleton(endpoints, title))}>{t.exportOpenapi}</button>
                <button type="button" style={button} onClick={() => save('postman.collection.json', postmanCollection(endpoints, title))}>{t.exportPostman}</button>
                <button
                    type="button" style={primaryButton} disabled={!onCompose || chosen.length === 0}
                    onClick={() => onCompose?.(fillTemplate(t.contractTestsText, { routes: chosen.slice(0, MAX_TEST_ROUTES).map(requestLine).join(', ') }))}
                >
                    {t.contractTests}
                </button>
            </div>
            {!onCompose && <Unavailable labels={labels} label={t.contractTests} testId="kg-api-compose-unavailable" />}
            <p data-testid="kg-api-selected" style={{ ...muted, margin: 0 }}>
                {chosen.length === 0 ? t.selectAtLeastOne : fillTemplate(t.selectedCount, { selected: chosen.length, total: endpoints.length })}
            </p>
            {chosen.length > MAX_TEST_ROUTES && <p data-testid="kg-api-capped" style={{ ...muted, margin: 0 }}>{fillTemplate(labels.surface.testsCapped, { count: MAX_TEST_ROUTES })}</p>}
            {failed && <p role="alert" style={{ ...muted, margin: 0 }}>{t.downloadFailed}</p>}
            <ApiEndpointCard endpoint={activeEndpoint} labels={labels} referrers={referrers} tryRequest={tryRequest} onPickFile={(ref) => onShow([ref])} />
            {bucket(split.inContract, fillTemplate(t.groupInContract, { count: split.inContract.length }), 'contract')}
            {bucket(split.undocumented, fillTemplate(t.groupUndocumented, { count: undocumented }), 'undocumented')}
        </div>
    );
}
