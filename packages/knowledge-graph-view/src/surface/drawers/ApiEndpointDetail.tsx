/**
 * One endpoint's detail in the API drawer: its parameters, whether a test file references the
 * handler ("responses tested") and who calls it. The callers are chips: choosing one selects that
 * file on the map (`onPickFile`). Everything comes from `EndpointDetail`.
 */

import { fillTemplate } from '../../labels';
import type { KnowledgeGraphLabels } from '../../labels';
import { heading, MONO, muted } from '../../styles';
import { Chip } from '../ui';
import type { EndpointDetail, FileRef, ParamRow } from './apiDetail';
import { StateLabel } from './ui';

type ApiLabels = KnowledgeGraphLabels['surface']['api'];

const whereLabel = (t: ApiLabels, where: ParamRow['where']): string => (where === 'path' ? t.paramPath : where === 'query' ? t.paramQuery : t.paramBody);

const MAX_FILES = 8;

function FileChips({ files, onPick, pickLabel }: { files: readonly FileRef[]; onPick?: ((ref: string) => void) | undefined; pickLabel: string }) {
    return (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {files.slice(0, MAX_FILES).map((f) => {
                const chip = <Chip tone="muted"><code style={{ fontFamily: MONO, fontSize: 11, overflowWrap: 'anywhere' }}>{f.name}</code></Chip>;
                return onPick ? (
                    <button
                        key={f.ref} type="button" data-file={f.ref} aria-label={fillTemplate(pickLabel, { name: f.name })} onClick={() => onPick(f.ref)}
                        style={{ minHeight: 32, padding: 0, border: 0, background: 'transparent', cursor: 'pointer', font: 'inherit' }}
                    >
                        {chip}
                    </button>
                ) : <span key={f.ref} data-file={f.ref}>{chip}</span>;
            })}
            {files.length > MAX_FILES && <span style={muted}>+{files.length - MAX_FILES}</span>}
        </div>
    );
}

export function ApiEndpointDetail({ detail, labels, onPickFile }: { detail: EndpointDetail; labels: KnowledgeGraphLabels; onPickFile?: ((ref: string) => void) | undefined }) {
    const t = labels.surface.api;
    return (
        <div data-testid="kg-api-detail" style={{ display: 'grid', gap: 8 }}>
            <h4 style={{ ...heading, fontSize: 12 }}>{t.detailParams}</h4>
            {detail.params.length === 0 ? <span style={muted}>{t.noParams}</span> : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
                    {detail.params.map((p) => (
                        <li key={`${p.where}:${p.name}`} data-param={`${p.where}:${p.name}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 120px) minmax(0, 1fr)', gap: 8 }}>
                            <code style={{ fontFamily: MONO, fontSize: 11, overflowWrap: 'anywhere' }}>{p.name}</code>
                            <span style={muted}>
                                {p.source === 'unknown-shape' ? fillTemplate(t.paramWithNote, { where: whereLabel(t, p.where), note: t.paramBodyNote }) : whereLabel(t, p.where)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            <h4 style={{ ...heading, fontSize: 12 }}>{t.detailTested}</h4>
            <div style={{ display: 'grid', gap: 4 }}>
                <StateLabel tone={detail.tested ? 'agrees' : 'cycle'} data-tested={detail.tested}>{detail.tested ? t.testedYes : t.testedNo}</StateLabel>
                {detail.tested
                    ? <FileChips files={detail.testFiles} pickLabel={t.pickFile} />
                    : <span style={muted}>{t.testedNone}</span>}
            </div>
            <h4 style={{ ...heading, fontSize: 12 }}>{t.detailCallers}</h4>
            {detail.callerFiles.length ? <FileChips files={detail.callerFiles} onPick={onPickFile} pickLabel={t.pickFile} /> : <span style={muted}>{t.callerFilesNone}</span>}
        </div>
    );
}
