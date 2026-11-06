/**
 * The header row under the status strip (56px): the spine, the ask bar (flex), the Panels group
 * and the Risk overlays menu. The ask bar is a 40px rounded search whose placeholder is the
 * active question as a sentence, with the answer mode as a mono note on its right and the
 * screenshot picker inside it. On a narrow container the row stacks: spine, then a full-width
 * 44px ask bar, then the Panels group scrolling sideways (the overlays move to the status strip).
 * The cameras, the questions and the lenses are the centre controls (`surface/SceneOverlay.tsx`).
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from './labels';
import { cssVar } from './scene/themeColors';
import { MONO, muted } from './styles';
import type { QuestionId } from './surface/questions';

export interface ToolbarProps {
    labels: KnowledgeGraphLabels;
    onSearch(q: string): void;
    /** The active question: its sentence is the ask bar's placeholder, its answer mode the note. */
    question: QuestionId;
    /** What `{name}` is in the sentence: the station, the line or the folder. */
    askName: string;
    /** The question's answer in words (`answerLine`): "3 stations", "No station matches.", "Not set up…". Shown beside the answer mode; empty ⇒ absent. */
    answer?: string | undefined;
    narrow: boolean;
    /** The drill path. */
    spine?: ReactNode;
    /** The Panels group. */
    panels?: ReactNode;
    /** The overlay menu (wide containers; a narrow one has it in the status strip). */
    overlays?: ReactNode;
    /**
     * Wraps the ask bar so the pinpoint input catches a paste or a drop anywhere on it and puts
     * its screenshot button inside: it calls `bar` with that button.
     */
    askWrap?: ((bar: (picker: ReactNode) => ReactNode) => ReactNode) | undefined;
    /** Opens the lines as a sheet where the left panel has collapsed. */
    linesToggle?: ReactNode;
}

const searchIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: 'none', fill: 'none', stroke: cssVar('muted'), strokeWidth: 1.6 }}>
        <circle cx="7" cy="7" r="5" /><path d="M11 11l4 4" />
    </svg>
);

export function Toolbar({ labels, onSearch, question, askName, answer, narrow, spine, panels, overlays, askWrap, linesToggle }: ToolbarProps) {
    const [q, setQ] = useState('');
    const s = labels.surface;
    const bar = (picker: ReactNode) => (
        <form
            role="search" onSubmit={(e) => { e.preventDefault(); onSearch(q); }}
            style={{
                flex: '1 1 180px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box', height: narrow ? 44 : 40, padding: '0 6px 0 12px',
                borderRadius: 10, border: `1px solid ${cssVar('border')}`, background: cssVar('bg'),
            }}
        >
            {searchIcon}
            <input
                type="search" aria-label={labels.searchLabel} placeholder={fillTemplate(s.askSentence[question], { name: askName })} value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', color: cssVar('text'), font: 'inherit', fontSize: narrow ? 14 : 13 }}
            />
            {answer && <span data-testid="kg-answer" role="status" style={{ ...muted, fontFamily: MONO, fontSize: 11, padding: '0 6px', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto', whiteSpace: narrow ? 'normal' : 'nowrap' }}>{answer}</span>}
            {!narrow && <span data-testid="kg-answer-mode" style={{ ...muted, fontFamily: MONO, fontSize: 11, padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto' }}>{s.answerMode[question]}</span>}
            {picker}
        </form>
    );
    const ask = askWrap ? askWrap(bar) : bar(null);
    const row: CSSProperties = narrow
        ? { display: 'grid', gap: 10, padding: '10px 12px' }
        : { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minHeight: 56, padding: '8px 16px' };
    return (
        <div style={{ ...row, boxSizing: 'border-box', flex: 'none', borderBottom: `1px solid ${cssVar('border')}`, background: cssVar('panel') }}>
            {spine}
            {ask}
            {narrow ? (
                (panels || linesToggle) && <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', maxWidth: '100%' }}>{linesToggle}{panels}</div>
            ) : (
                <>{linesToggle}{panels}{overlays}</>
            )}
        </div>
    );
}
