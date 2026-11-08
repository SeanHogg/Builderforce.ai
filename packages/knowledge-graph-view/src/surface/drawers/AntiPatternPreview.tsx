/**
 * The Patterns drawer's preview (the mockup's C2): for each selected group a before/after and the
 * change itself (the host's real lines when a codemod exists, else the agent's fixed plan), then
 * Back and "Apply N fixes". Nothing changes until Apply; Apply shows its progress with a Cancel,
 * says what could not be applied, and hands over to the Resolve flow so checks and Undo continue
 * there (`antiPatternApply.ts`).
 */

import { useRef, useState } from 'react';
import type { Finding, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { findingRequest, findingTitle } from '../../findingText';
import { fillTemplate } from '../../labels';
import { labelFor } from '../../graphModel';
import { cssVar } from '../../scene/themeColors';
import { button, card, quietButton } from '../../styles';
import { FixPreviewView } from '../fix/FixPreviewView';
import { canApplyKind } from '../codemods';
import { counted } from '../plural';
import { findingProvenance } from '../scope';
import { ProvenanceBadge } from '../ui';
import { TYPE } from '../ui/type';
import type { PanelProps } from '../registry';
import { useShowInTower } from '../useShowInTower';
import type { AntiPatternGroup } from './antiPatternGroups';
import { applyAntiPatterns, canApplyAll } from './antiPatternApply';
import { AntiPatternBeforeAfter } from './AntiPatternBeforeAfter';
import { layerNames } from './AntiPatternCard';
import { PREVIEW_SAMPLE, useGroupPreviews } from './useGroupPreviews';
import { PatternsFooter } from './PatternsFooter';

export type PreviewProps = Pick<PanelProps, 'graph' | 'labels' | 'source' | 'surface' | 'onCompose' | 'onChanged' | 'onShow' | 'onCamera' | 'cameras'> & {
    groups: readonly AntiPatternGroup[];
    /** The panel's node index, so the preview does not build a second one. */
    index: ReadonlyMap<string, KNode>;
    onBack(): void;
};

export function AntiPatternPreview({ labels, source, surface, onCompose, onChanged, onShow, onCamera, cameras, groups, index, onBack }: PreviewProps) {
    const t = labels.surface.patterns;
    const tower = useShowInTower({ surface, onShow, onCamera, cameras });
    const previews = useGroupPreviews(groups, source);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const [failed, setFailed] = useState<Finding[]>([]);
    const [errored, setErrored] = useState(false);
    const cancelled = useRef(false);
    const busy = progress !== null;
    const possible = canApplyAll(groups, source, !!onCompose);

    const apply = async () => {
        cancelled.current = false;
        setErrored(false);
        setFailed([]);
        setProgress({ done: 0, total: groups.filter((g) => canApplyKind(source, g.kind)).reduce((n, g) => n + g.count, 0) });
        try {
            const out = await applyAntiPatterns(groups, { source, labels, index, onCompose, onProgress: (done, total) => setProgress({ done, total }), cancelled: () => cancelled.current });
            for (const a of out.applied) surface.dispatchFix(a.finding.id, { type: 'applied', applied: a.fix });
            for (const f of out.composed) surface.dispatchFix(f.id, { type: 'promptSent' });
            if (out.applied.length > 0) onChanged?.();
            setFailed(out.failed);
            if (out.first && out.failed.length === 0) surface.resolve(out.first);
        } catch {
            setErrored(true);
        } finally {
            setProgress(null);
        }
    };

    return (
        <div data-testid="kg-patterns-preview" style={{ display: 'grid', gap: 14, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" style={quietButton} onClick={onBack}>{t.backToPatterns}</button>
                <h3 style={{ ...TYPE.title, flex: 1 }}>{counted(labels, 'previewFix', groups.length)}</h3>
                <button type="button" style={button} disabled={!tower.canShow} onClick={() => tower.show(groups)}>{t.showInTower}</button>
            </div>
            {groups.map((g) => {
                const first = g.findings[0]!;
                const names = layerNames(g, labels);
                const host = canApplyKind(source, g.kind);
                const head = g.from !== undefined && g.to !== undefined ? fillTemplate(t.route, { from: names.from, to: names.to }) : findingTitle(first, labels);
                const files = (previews[g.id]?.files) ?? g.files.slice(0, 5).map((r) => ({ path: labelFor(index, r) }));
                return (
                    <section key={g.id} data-preview={g.id} style={{ ...card, display: 'grid', gap: 10, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong style={{ ...TYPE.title, flex: 1 }}>{head} · {counted(labels, g.from !== undefined ? 'link' : 'finding', g.count)}</strong>
                            <ProvenanceBadge provenance={findingProvenance(first)} labels={labels} />
                            <span style={{ ...TYPE.tag, color: cssVar(host ? 'agrees' : 'cycle') }}>{host ? t.tagHost : t.tagAgent}</span>
                        </div>
                        <AntiPatternBeforeAfter group={g} labels={labels} index={index} />
                        {host
                            ? (
                                <>
                                    <FixPreviewView files={files} fromHost={!!previews[g.id]} labels={labels} />
                                    {g.count > PREVIEW_SAMPLE && <span data-testid="kg-preview-sample" style={TYPE.meta}>{fillTemplate(t.sampleOf, { shown: PREVIEW_SAMPLE, total: g.count.toLocaleString() })}</span>}
                                </>
                            )
                            : (
                                <div style={{ display: 'grid', gap: 4 }}>
                                    <span style={{ ...TYPE.meta }}>{t.agentNote}</span>
                                    <pre style={{ margin: 0, padding: 8, borderRadius: 6, background: cssVar('plane'), whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...TYPE.mono }}>
                                        {findingRequest(first, labels, index)}
                                    </pre>
                                </div>
                            )}
                    </section>
                );
            })}
            <span style={{ ...TYPE.body, color: cssVar('muted') }}>{t.previewNote}</span>
            {progress && (
                <div role="status" data-testid="kg-apply-progress" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', ...TYPE.body }}>
                    <span>{fillTemplate(t.applyProgress, { done: progress.done.toLocaleString(), total: progress.total.toLocaleString() })}</span>
                    <button type="button" style={button} onClick={() => { cancelled.current = true; }}>{t.cancel}</button>
                </div>
            )}
            {failed.length > 0 && (
                <div role="alert" data-testid="kg-apply-failed" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', color: cssVar('errorText'), ...TYPE.body }}>
                    <span>{counted(labels, 'applyFailed', failed.length)}</span>
                    <button type="button" style={button} onClick={() => surface.resolve(failed[0]!)}>{t.resolveFailed}</button>
                </div>
            )}
            {errored && <span role="alert" data-testid="kg-apply-error" style={{ color: cssVar('errorText'), ...TYPE.body }}>{t.applyError}</span>}
            <PatternsFooter
                labels={labels} count={groups.length} action={busy ? t.applying : counted(labels, 'applyFixes', groups.length)}
                disabled={busy || groups.length === 0 || !possible} onAction={() => void apply()}
                secondary={{ label: t.back, onClick: onBack }} note={possible ? t.applyNote : t.noComposerNote}
            />
        </div>
    );
}
