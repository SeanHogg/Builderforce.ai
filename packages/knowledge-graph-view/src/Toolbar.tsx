/**
 * The header row (56px): the spine, the ask bar (flex) and, at the right end, ONE action slot (the
 * review status chip + button, `surface/ReviewAction.tsx`). The ask bar is a 40px rounded search whose placeholder is the
 * active question as a sentence (its value until something is typed, with the sentence also the
 * placeholder), with ONE mono note on its right (answer mode · answer, or just "not set up") and
 * the screenshot picker inside it. On a narrow container the row stacks: spine, then a full-width
 * 44px ask bar, then the lines toggle and the action in one sideways-scrolling row.
 * The cameras, the Panels and overlay tools, the questions, the commit scrubber and the lenses are the
 * canvas controls (`surface/SceneOverlay.tsx`).
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from './labels';
import { cssVar } from './scene/themeColors';
import { muted } from './styles';
import { TYPE } from './surface/ui/type';
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
    /** The review action (status chip + button): the right end of the row; on a narrow container, beside the lines toggle. */
    action?: ReactNode;
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

export function Toolbar({ labels, onSearch, question, askName, answer, narrow, spine, action, askWrap, linesToggle }: ToolbarProps) {
    // null = nothing typed: the box shows the active question as its value, in the normal text colour; typing replaces it.
    const [typed, setTyped] = useState<string | null>(null);
    const s = labels.surface;
    const sentence = fillTemplate(s.askSentence[question], { name: askName });
    const q = typed ?? '';
    // ONE note: a question whose data was never collected says so alone; otherwise the answer mode, then the answer.
    const notSetUp = answer === s.answerNotSetUp;
    const showMode = !narrow && !notSetUp;
    const noteStyle: CSSProperties = { ...muted, ...TYPE.mono, padding: '0 6px', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto', whiteSpace: narrow ? 'normal' : 'nowrap' };
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
                type="search" aria-label={labels.searchLabel} placeholder={sentence} value={typed ?? sentence}
                onFocus={(e) => { if (typed === null) e.currentTarget.select(); }}
                onChange={(e) => setTyped(e.target.value)}
                style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', color: cssVar('text'), font: 'inherit', ...TYPE.input, ...(narrow ? { fontSize: TYPE.title.fontSize } : null) }}
            />
            {(answer || showMode) && (
                <span data-testid="kg-answer" role="status" style={noteStyle}>
                    {showMode && <span data-testid="kg-answer-mode">{s.answerMode[question]}</span>}
                    {showMode && answer ? ' · ' : ''}{answer}
                </span>
            )}
            {picker}
        </form>
    );
    const ask = askWrap ? askWrap(bar) : bar(null);
    const row: CSSProperties = narrow
        ? { display: 'grid', gap: 10, padding: '10px 12px' }
        // One 56px line from COMPACT_WIDTH up: the spine and the ask bar shrink (min-width 0); the action keeps its size.
        : { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap', height: 56, padding: '0 16px' };
    return (
        <div style={{ ...row, boxSizing: 'border-box', flex: 'none', borderBottom: `1px solid ${cssVar('border')}`, background: cssVar('panel') }}>
            {spine}
            {ask}
            {narrow ? (
                (action || linesToggle) && <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', maxWidth: '100%', padding: 3, margin: -3 }}>{linesToggle}{action}</div>
            ) : (
                <>{linesToggle}{action}</>
            )}
        </div>
    );
}
