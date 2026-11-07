/**
 * One endpoint row of the API drawer (the master list): a checkbox (is it in the contract tests),
 * the method badge and path as one button that selects the endpoint, and its contract state. The
 * selected endpoint's card is drawn once, by the panel.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { muted } from '../../styles';
import { TYPE } from '../ui/type';
import { requestLine, type Endpoint } from './apiModel';
import { MethodBadge } from './MethodBadge';
import { StateLabel } from './ui';

export interface ApiEndpointRowProps {
    endpoint: Endpoint;
    labels: KnowledgeGraphLabels;
    included: boolean;
    active: boolean;
    onToggle(): void;
    onSelect(): void;
}

export function ApiEndpointRow({ endpoint: e, labels, included, active, onToggle, onSelect }: ApiEndpointRowProps) {
    const t = labels.surface.api;
    return (
        <li data-endpoint={requestLine(e)} data-active={active} style={{ display: 'grid', gap: 2, padding: '4px 0' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                    type="checkbox" checked={included} onChange={onToggle}
                    aria-label={fillTemplate(t.selectEndpoint, { route: requestLine(e) })}
                    style={{ width: 18, height: 18, margin: 0, flex: 'none', accentColor: cssVar('accent') }}
                />
                <button
                    type="button" data-action="select" aria-pressed={active} onClick={onSelect}
                    style={{
                        flex: 1, minWidth: 0, minHeight: 36, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', textAlign: 'start', cursor: 'pointer', font: 'inherit',
                        padding: '2px 8px', borderRadius: 8, color: cssVar('text'), background: active ? cssVar('plane') : 'transparent',
                        border: `1px solid ${active ? cssVar('accent') : cssVar('border')}`,
                    }}
                >
                    <MethodBadge method={e.method} />
                    <code style={{ ...TYPE.monoValue, overflowWrap: 'anywhere' }}>{e.path}</code>
                    <span style={{ flex: 1 }} />
                    <StateLabel tone={e.documented ? 'agrees' : 'cycle'} data-documented={e.documented}>{e.documented ? t.documented : t.undocumented}</StateLabel>
                </button>
            </div>
            <span style={{ ...muted, paddingInlineStart: 26 }}>{e.callers.length ? fillTemplate(t.callers, { names: e.callers.join(', ') }) : t.noCallers}</span>
        </li>
    );
}
