/**
 * What the SCENE shows when the map cannot be drawn: the surface frame around it is always
 * the normal layout, never a full-pane screen.
 *
 *  - `SceneState`  no graph yet: a small inline status while the first read runs, or a
 *    centred dashed card (empty folder, failed read) built from `SurfaceState`'s content.
 *  - `SceneStatus` a graph IS drawn but is the last one seen: "Updating…" while a fresh
 *    read runs, or "Couldn't update — showing the last graph. Retry" when it failed.
 */

import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { muted } from '../styles';
import { TYPE } from './ui/type';
import { SurfaceState, type SurfaceStateProps } from './SurfaceStates';

export function SceneState(props: SurfaceStateProps) {
    const pending = props.status !== 'empty' && props.status !== 'error' && props.status !== 'load-failed';
    if (pending) {
        return (
            <div style={{ position: 'absolute', inset: 0, padding: 16 }}>
                <SurfaceState {...props} />
            </div>
        );
    }
    return (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 16, overflow: 'auto' }}>
            <div style={{ width: 'min(420px, 100%)', border: `1px dashed ${cssVar('border')}`, borderRadius: 12, background: cssVar('panel') }}>
                <SurfaceState {...props} />
            </div>
        </div>
    );
}

export function SceneStatus({ stale, refreshFailed, labels, onRetry }: { stale: boolean; refreshFailed: boolean; labels: KnowledgeGraphLabels; onRetry(): void }) {
    if (!stale && !refreshFailed) return null;
    const corner = { position: 'absolute', left: 12, bottom: 12, zIndex: 2, ...muted } as const;
    if (refreshFailed) {
        return (
            <span role="status" style={corner}>
                <button
                    type="button" onClick={onRetry}
                    style={{ minHeight: 28, padding: '0 10px', borderRadius: 8, border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), color: cssVar('text'), cursor: 'pointer', font: 'inherit', ...TYPE.pill }}
                >
                    {labels.refreshFailed}
                </button>
            </span>
        );
    }
    return <span role="status" style={{ ...corner, padding: '4px 10px', borderRadius: 8, background: cssVar('panel'), pointerEvents: 'none' }}>{labels.refreshing}</span>;
}
