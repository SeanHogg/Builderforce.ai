/**
 * The API drawer: the endpoints read from the `routes` badge, grouped by the file that
 * registers them, with who calls each (the stations that import the file) and whether an
 * OpenAPI document in the graph documents it. With no such document every endpoint is
 * undocumented and a KPI says the contract is missing. *Try it* shows the request line and
 * copies a curl; the OpenAPI skeleton and Postman collection are generated here and
 * downloaded; *Contract tests* hands the agent a fixed request.
 */

import { useMemo, useState } from 'react';
import { CopiedNote, CopyFallback, useCopyText } from '../../copyText';
import { fillTemplate } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { button, card, heading, muted, primaryButton } from '../../styles';
import type { PanelProps } from '../registry';
import { curlOf, endpointsOf, groupByFile, openApiDocs, openApiSkeleton, postmanCollection, requestLine, type Endpoint } from './apiModel';
import { downloadJson } from './download';
import { Kpi, kpiGrid, NotSetUp } from './ui';

const MAX_TEST_ROUTES = 20;

function EndpointRow({ e, labels }: { e: Endpoint; labels: PanelProps['labels'] }) {
    const t = labels.surface.api;
    const [open, setOpen] = useState(false);
    const copier = useCopyText();
    const curl = curlOf(e);
    return (
        <li data-endpoint={requestLine(e)} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{requestLine(e)}</code>
                <span data-documented={e.documented} style={{ fontSize: 10, fontWeight: 700, color: cssVar(e.documented ? 'agrees' : 'cycle') }}>
                    {e.documented ? t.documented : t.undocumented}
                </span>
                <button type="button" aria-expanded={open} style={{ ...button, minHeight: 32 }} onClick={() => setOpen((v) => !v)}>{t.tryIt}</button>
            </div>
            <span style={muted}>{e.callers.length ? fillTemplate(t.callers, { names: e.callers.join(', ') }) : t.noCallers}</span>
            {open && (
                <div style={{ ...card, display: 'grid', gap: 6 }}>
                    <span style={muted}>{t.requestLine}</span>
                    <code style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{curl}</code>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button type="button" style={button} onClick={() => void copier.copy(curl)}>{t.copyCurl}</button>
                        <CopiedNote status={copier.status} labels={labels} />
                    </div>
                    <CopyFallback status={copier.status} text={curl} label={t.copyCurl} labels={labels} />
                </div>
            )}
        </li>
    );
}

export function ApiPanel({ graph, labels, surface, rootTitle, onCompose }: PanelProps) {
    const t = labels.surface.api;
    const endpoints = useMemo(() => endpointsOf(graph, surface.stations), [graph, surface.stations]);
    const groups = useMemo(() => groupByFile(endpoints), [endpoints]);
    const hasContract = useMemo(() => openApiDocs(graph.nodes).length > 0, [graph.nodes]);
    const [failed, setFailed] = useState(false);
    if (endpoints.length === 0) return <NotSetUp title={t.notSetUpTitle} body={t.notSetUpBody} />;
    const undocumented = endpoints.filter((e) => !e.documented).length;
    const title = rootTitle ?? graph.scope.rootId;
    const save = (name: string, value: unknown) => setFailed(!downloadJson(name, value));

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
                    type="button" style={primaryButton} disabled={!onCompose}
                    onClick={() => onCompose?.(fillTemplate(t.contractTestsText, { routes: endpoints.slice(0, MAX_TEST_ROUTES).map(requestLine).join(', ') }))}
                >
                    {t.contractTests}
                </button>
            </div>
            {endpoints.length > MAX_TEST_ROUTES && <p data-testid="kg-api-capped" style={{ ...muted, margin: 0 }}>{fillTemplate(labels.surface.testsCapped, { count: MAX_TEST_ROUTES })}</p>}
            {failed && <p role="alert" style={{ ...muted, margin: 0 }}>{t.downloadFailed}</p>}
            {groups.map((g) => (
                <section key={g.file} aria-label={fillTemplate(t.groupAria, { file: g.fileName, count: g.endpoints.length })} style={{ display: 'grid', gap: 6 }}>
                    <h3 style={{ ...heading, overflowWrap: 'anywhere' }}>{g.fileName}</h3>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                        {g.endpoints.map((e, i) => <EndpointRow key={`${g.file}|${requestLine(e)}|${i}`} e={e} labels={labels} />)}
                    </ul>
                </section>
            ))}
        </div>
    );
}
