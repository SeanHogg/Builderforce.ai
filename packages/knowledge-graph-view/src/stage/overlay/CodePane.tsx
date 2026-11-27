/**
 * The left column of the stage. Code and entry-point lines share the same dock. The Code tab
 * shows the selected hierarchy, source and the explanation of the selected mark.
 */

import { useState, type ReactNode } from 'react';
import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { PanelChevron } from '../../surface/ui/PanelChevron';
import { TYPE } from '../../surface/ui/type';
import { Pill } from '../../surface/ui/Pill';
import { CodeTree, type CodeTreeProps } from './CodeTree';

export interface CodePaneProps {
    labels: KnowledgeGraphLabels;
    tree: Omit<CodeTreeProps, 'labels'>;
    /** The file being read (`CodeDock`). */
    source: ReactNode;
    /** The "In plain words" text. */
    say: string;
    /** Hide the pane (the viewer's `code` slot). */
    onHide?: (() => void) | undefined;
    /** A note when the host cannot read source. */
    note?: string | undefined;
    /** One half of a narrow stage's Code | Picture switch: no right border. */
    narrow: boolean;
    lines?: ReactNode;
    hierarchy?: ReactNode;
    outline?: ReactNode;
}

export function CodePane({ labels, tree, source, say, onHide, note, narrow, lines, hierarchy, outline }: CodePaneProps) {
    const t = labels.surface.code;
    const [showLines, setShowLines] = useState(false);
    const lineTab = !!lines && showLines;
    return (
        <aside
            data-code-dock data-code-pane data-level-outline role="complementary" aria-label={t.dockAria}
            style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0, background: cssVar('panel'), color: cssVar('text'), borderInlineEnd: narrow ? 0 : `1px solid ${cssVar('border')}` }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px 4px' }}>
                {lines ? <div role="group" aria-label={t.dockAria} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    <Pill on={!lineTab} aria-pressed={!lineTab} onClick={() => setShowLines(false)}>{t.paneCode}</Pill>
                    <Pill on={lineTab} aria-pressed={lineTab} onClick={() => setShowLines(true)}>{labels.surface.linesButton}</Pill>
                </div> : <h2 style={{ ...TYPE.sectionHeading }}>{t.paneCode}</h2>}
                {onHide && <PanelChevron action="dock-hide" open label={t.dockHide} onClick={onHide} style={{ marginInlineStart: 'auto' }} />}
            </div>
            {lineTab ? (
                <div style={{ padding: '0 12px 12px', minHeight: 0, flex: 1, overflow: 'auto' }}>{lines}</div>
            ) : <>
                {hierarchy}
                {outline ?? <CodeTree {...tree} labels={labels} />}
                {source ?? (
                    <div style={{ flex: outline ? '0 0 auto' : '1 1 0', minHeight: 0, overflow: 'auto', background: cssVar('bg') }}>
                        {note && <p role="note" data-outline-note style={{ margin: '8px 12px', ...TYPE.meta }}>{note}</p>}
                    </div>
                )}
                <div data-code-say style={{ padding: '10px 12px', borderTop: `1px solid ${cssVar('border')}`, ...TYPE.body, fontSize: 12.5 }}>
                    <div><b style={{ fontWeight: 600 }}>{t.sayLead}</b> {say}</div>
                    <div style={{ marginTop: 4, ...TYPE.meta, color: cssVar('muted') }}>{t.sayHint}</div>
                </div>
            </>}
        </aside>
    );
}
