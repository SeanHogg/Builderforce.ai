/**
 * The code pane (the design's `#code`): always the left column of a wide stage. A header ("Code", and faintly "same place as
 * the picture"), the level TREE (`CodeTree`), then the source area: the file being read (`CodeDock`: its file bar, the
 * source with its lens rows) or, while no file is open (a station, a system), the folder listing of the level's members;
 * and under it the SAY box, the plain words about what is selected. Panel background, no right border in a narrow stage.
 */

import type { ReactNode } from 'react';
import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { typeShape, type MarkType } from '../../shapes';
import { ShapeGlyph } from '../../surface/LegendGlyph';
import type { Station } from '../../surface/stations';
import { actionGlyph } from '../../surface/ui/glyphs';
import { FONT_MONO, TYPE } from '../../surface/ui/type';
import { toggleButton } from './cardStyles';
import { CodeTree, type CodeTreeProps } from './CodeTree';

export interface CodePaneProps {
    labels: KnowledgeGraphLabels;
    tree: Omit<CodeTreeProps, 'labels'>;
    /** The file being read (`CodeDock`); null ⇒ the folder listing. */
    source: ReactNode;
    /** The "In plain words" text. */
    say: string;
    /** Hide the pane (the viewer's `code` slot). */
    onHide?: (() => void) | undefined;
    /** A note under the listing when the host cannot read source. */
    note?: string | undefined;
    /** One half of a narrow stage's Code | Picture switch: no right border. */
    narrow: boolean;
}

function FolderListing({ stations, keyOf, types, selected, onSelect, onHover }: Pick<CodeTreeProps, 'stations' | 'keyOf' | 'types' | 'selected' | 'onSelect' | 'onHover'>) {
    return (
        <ul data-folder-listing style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {stations.map((s: Station) => {
                const key = keyOf(s), type: MarkType | undefined = types.get(s.id);
                return (
                    <li key={s.id}>
                        <button
                            type="button" aria-current={key === selected ? 'true' : undefined} onClick={() => onSelect(key)} onMouseEnter={() => onHover(key)} onMouseLeave={() => onHover(null)}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 24, padding: '0 12px', border: 0, textAlign: 'left', cursor: 'pointer', color: cssVar(key === selected ? 'text' : 'muted'), background: key === selected ? cssVar('accentSoft') : 'none', font: 'inherit', fontFamily: FONT_MONO, fontSize: 12.5 }}
                        >
                            {type && <ShapeGlyph shape={typeShape(type)} size={12} />}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.path ?? s.name}</span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

export function CodePane({ labels, tree, source, say, onHide, note, narrow }: CodePaneProps) {
    const t = labels.surface.code;
    return (
        <aside
            data-code-dock data-code-pane data-level-outline role="complementary" aria-label={t.dockAria}
            style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0, background: cssVar('panel'), color: cssVar('text'), borderInlineEnd: narrow ? 0 : `1px solid ${cssVar('border')}` }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px 4px' }}>
                <h2 style={{ ...TYPE.sectionHeading }}>{t.paneCode}</h2>
                <span style={{ ...TYPE.meta, color: cssVar('muted'), marginInlineStart: 'auto' }}>{t.samePlace}</span>
                {onHide && <button type="button" data-action="dock-hide" aria-label={t.dockHide} title={t.dockHide} onClick={onHide} style={{ ...toggleButton, minHeight: 24 }}><span aria-hidden="true" style={{ display: 'inline-flex' }}>{actionGlyph('close')}</span></button>}
            </div>
            <CodeTree {...tree} labels={labels} />
            {source ?? (
                <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'auto', padding: '6px 0', background: cssVar('bg') }}>
                    <FolderListing {...tree} />
                    {note && <p role="note" data-outline-note style={{ margin: '8px 12px', ...TYPE.meta }}>{note}</p>}
                </div>
            )}
            <div data-code-say style={{ padding: '10px 12px', borderTop: `1px solid ${cssVar('border')}`, ...TYPE.body, fontSize: 12.5 }}>
                <div><b style={{ fontWeight: 600 }}>{t.sayLead}</b> {say}</div>
                <div style={{ marginTop: 4, ...TYPE.meta, color: cssVar('muted') }}>{t.sayHint}</div>
            </div>
        </aside>
    );
}
