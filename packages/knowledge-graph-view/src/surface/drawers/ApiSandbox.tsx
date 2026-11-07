/**
 * The API drawer's *Try it · sandbox*: the request line and Copy as curl always, and Send when
 * the host offers `tryRequest`. The base URL is typed by the person and starts at localhost;
 * the host decides where a request may go. A host without `tryRequest` (the web: no safe
 * server-side proxy) shows "Send is available in the editor", never a dead button.
 */

import { useState } from 'react';
import { CopiedNote, CopyFallback, useCopyText } from '../../copyText';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { button, input, muted, primaryButton } from '../../styles';
import { TYPE } from '../ui/type';
import type { TryRequest, TryResponse } from '../../types';
import { paramKey, type ParamRow } from './apiDetail';
import { bodyMethod, curlOf, type Endpoint } from './apiModel';
import { buildTryRequest, clipBody, DEFAULT_BASE_URL, isLocalBase, isSuccess, parseBaseUrl } from './apiTry';
import { useTryRequest } from './useTryRequest';

type ApiLabels = KnowledgeGraphLabels['surface']['api'];

function Result({ res, t }: { res: TryResponse; t: ApiLabels }) {
    const clipped = clipBody(res.body);
    const text = clipped.text;
    const shortened = clipped.shortened || res.truncated === true;
    const headers = Object.entries(res.headers);
    return (
        <div data-testid="kg-api-result" style={{ display: 'grid', gap: 6 }}>
            <strong data-ok={isSuccess(res.status)} style={{ ...TYPE.monoValue, fontWeight: 700, color: cssVar(isSuccess(res.status) ? 'agrees' : 'cycle') }}>
                {fillTemplate(t.resultStatus, { status: res.status, ms: Math.round(res.ms) })}
            </strong>
            {headers.length > 0 && (
                <details>
                    <summary style={muted}>{t.resultHeaders}</summary>
                    <pre style={{ margin: 0, ...TYPE.monoName, fontWeight: 400, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{headers.map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
                </details>
            )}
            <span style={muted}>{t.resultBody}</span>
            {text ? (
                <pre style={{ margin: 0, ...TYPE.monoName, fontWeight: 400, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto', padding: 8, borderRadius: 6, border: `1px solid ${cssVar('border')}`, background: cssVar('bg') }}>{text}</pre>
            ) : <span style={muted}>{t.resultEmpty}</span>}
            {shortened && <span style={muted}>{fillTemplate(t.resultTruncated, { count: text.length })}</span>}
        </div>
    );
}

export interface ApiSandboxProps {
    endpoint: Endpoint;
    params: readonly ParamRow[];
    labels: KnowledgeGraphLabels;
    tryRequest?: ((req: TryRequest) => Promise<TryResponse>) | undefined;
}

export function ApiSandbox({ endpoint, params, labels, tryRequest }: ApiSandboxProps) {
    const t = labels.surface.api;
    const copier = useCopyText();
    const { state, send } = useTryRequest(tryRequest);
    const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
    const [values, setValues] = useState<Record<string, string>>({});
    const [body, setBody] = useState('{}');
    const [problem, setProblem] = useState<string | null>(null);
    const curl = curlOf(endpoint);
    const base = parseBaseUrl(baseUrl);
    const fields = params.filter((p) => p.where !== 'body');

    /** Any edit makes the last problem stale: clear it. */
    const edit = (change: () => void) => { setProblem(null); change(); };

    const onSend = () => {
        const built = buildTryRequest(endpoint, params, baseUrl, values, body);
        if (!built.ok) {
            setProblem(built.reason === 'baseUrl' || built.reason === 'origin' ? t.baseUrlInvalid : built.reason === 'body' ? t.bodyInvalid : fillTemplate(t.paramMissing, { name: built.name ?? '' }));
            return;
        }
        setProblem(null);
        send(built.req);
    };

    return (
        <div data-testid="kg-api-sandbox" style={{ display: 'grid', gap: 8 }}>
            <h4 style={TYPE.sectionHeading}>{t.sandboxTitle}</h4>
            <span style={muted}>{t.requestLine}</span>
            <code style={{ ...TYPE.monoValue, overflowWrap: 'anywhere' }}>{curl}</code>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" style={button} onClick={() => void copier.copy(curl)}>{t.copyCurl}</button>
                <CopiedNote status={copier.status} labels={labels} />
            </div>
            <CopyFallback status={copier.status} text={curl} label={t.copyCurl} labels={labels} />
            {!tryRequest ? <p role="status" data-testid="kg-api-send-unavailable" style={{ ...muted, margin: 0 }}>{t.sendUnavailable}</p> : (
                <div style={{ display: 'grid', gap: 8 }}>
                    <label style={{ display: 'grid', gap: 4 }}>
                        <span style={muted}>{t.baseUrl}</span>
                        <input value={baseUrl} onChange={(e) => edit(() => setBaseUrl(e.target.value))} inputMode="url" spellCheck={false} style={{ ...input, ...TYPE.monoValue, width: '100%', boxSizing: 'border-box' }} />
                    </label>
                    {base && !isLocalBase(base) && <span role="status" style={muted}>{t.baseUrlRemote}</span>}
                    {fields.map((p) => (
                        <label key={paramKey(p)} style={{ display: 'grid', gap: 4 }}>
                            <span style={muted}>{fillTemplate(t.paramValue, { name: p.name })}</span>
                            <input
                                value={values[paramKey(p)] ?? ''} spellCheck={false}
                                onChange={(e) => edit(() => setValues((v) => ({ ...v, [paramKey(p)]: e.target.value })))}
                                style={{ ...input, ...TYPE.monoValue, width: '100%', boxSizing: 'border-box' }}
                            />
                        </label>
                    ))}
                    {bodyMethod(endpoint.method) && (
                        <label style={{ display: 'grid', gap: 4 }}>
                            <span style={muted}>{t.bodyLabel}</span>
                            <textarea value={body} onChange={(e) => edit(() => setBody(e.target.value))} rows={4} spellCheck={false} style={{ ...input, padding: 8, ...TYPE.monoValue, width: '100%', boxSizing: 'border-box' }} />
                        </label>
                    )}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button type="button" data-action="send" style={primaryButton} disabled={state.phase === 'sending'} onClick={onSend}>
                            {state.phase === 'sending' ? t.sending : t.send}
                        </button>
                    </div>
                    {problem && <p role="alert" style={{ ...muted, margin: 0, color: cssVar('cycle') }}>{problem}</p>}
                    {state.phase === 'failed' && <p role="alert" data-testid="kg-api-send-failed" style={{ ...muted, margin: 0, color: cssVar('cycle') }}>{fillTemplate(t.sendFailed, { message: state.message })}</p>}
                    {state.phase === 'done' && <Result res={state.res} t={t} />}
                </div>
            )}
        </div>
    );
}
