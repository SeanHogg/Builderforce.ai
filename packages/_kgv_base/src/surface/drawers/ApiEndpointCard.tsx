/**
 * The selected endpoint of the API drawer: its method badge and path, four KPIs (parameters,
 * callers, test files, contract state), the detail (parameters, tested, who calls it) and the
 * sandbox. One card for the one endpoint the list has selected.
 */

import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { card } from '../../styles';
import { TYPE } from '../ui/type';
import type { TryRequest, TryResponse } from '../../types';
import { ApiEndpointDetail } from './ApiEndpointDetail';
import { ApiSandbox } from './ApiSandbox';
import { detailOf, type FileRef } from './apiDetail';
import type { Endpoint } from './apiModel';
import { MethodBadge } from './MethodBadge';
import { Kpi, kpiGrid } from './ui';

export interface ApiEndpointCardProps {
    endpoint: Endpoint;
    labels: KnowledgeGraphLabels;
    referrers: ReadonlyMap<string, readonly FileRef[]>;
    tryRequest?: ((req: TryRequest) => Promise<TryResponse>) | undefined;
    /** A caller chip was chosen: select that file on the map. */
    onPickFile(ref: string): void;
}

export function ApiEndpointCard({ endpoint: e, labels, referrers, tryRequest, onPickFile }: ApiEndpointCardProps) {
    const t = labels.surface.api;
    const detail = detailOf(referrers, e);
    return (
        <section data-testid="kg-api-card" aria-label={`${e.method} ${e.path}`} style={{ ...card, display: 'grid', gap: 12, borderColor: cssVar('accent') }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <MethodBadge method={e.method} />
                <code style={{ ...TYPE.monoTitle, overflowWrap: 'anywhere' }}>{e.path}</code>
            </div>
            <div style={kpiGrid}>
                <Kpi label={t.kpiParams} value={detail.params.length} />
                <Kpi label={t.kpiCallers} value={detail.callerFiles.length} />
                <Kpi label={t.kpiTests} value={detail.testFiles.length} tone={detail.tested ? 'agrees' : 'cycle'} />
                <Kpi label={t.kpiContract} value={e.documented ? t.documented : t.undocumented} tone={e.documented ? 'agrees' : 'cycle'} />
            </div>
            <ApiEndpointDetail detail={detail} labels={labels} onPickFile={onPickFile} />
            <ApiSandbox key={`${e.file}|${e.method} ${e.path}`} endpoint={e} params={detail.params} labels={labels} tryRequest={tryRequest} />
        </section>
    );
}
