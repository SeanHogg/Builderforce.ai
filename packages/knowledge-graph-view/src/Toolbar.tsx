/**
 * The header row (design prototype `#top`: 38px, the panel background, a bottom border): an Out icon button (climbs one level), the spine as mono crumbs and,
 * right-aligned, the search icon button (it expands into the ask input), the review status button and the Panels button (it toggles the drawer). The ask
 * input's placeholder is the active question as a sentence; the screenshot picker sits inside it (`askWrap` = `PinpointInput`). The theme switch is the host's,
 * so there is none here.
 *
 * `wrapped` (the prototype's `max-width: 900px` rules, read from the CONTAINER width): the row wraps, the spine takes its own full-width row (below the buttons),
 * the right group fills the first row and ends it, the search icon is gone (the input is simply shown) and a Code | Picture switch joins the right group.
 * The cameras, the questions and the commit scrubber are the scene's toolbar (`surface/SceneOverlay.tsx`).
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from './labels';
import { cssVar } from './scene/themeColors';
import { ghostButtonStyle, Seg } from './surface/ui';
import { chromeGlyph } from './surface/ui/glyphs';
import { TYPE } from './surface/ui/type';
import type { QuestionId } from './surface/questions';

export interface ToolbarProps {
    labels: KnowledgeGraphLabels;
    onSearch(q: string): void;
    /** The active question: its sentence is the ask input's placeholder. */
    question: QuestionId;
    /** What `{name}` is in the sentence: the station, the line or the folder. */
    askName: string;
    /** The prototype's ≤900px rules: the row wraps and the spine takes its own row. */
    wrapped: boolean;
    /** The level above ("the line"); null/absent ⇒ the Out button is disabled and says "Top level". */
    outTo?: string | null | undefined;
    onOut?: (() => void) | undefined;
    /** The drill path. */
    spine?: ReactNode;
    /** The review status button: the right group. */
    action?: ReactNode;
    /** The Panels button: whether the drawer is open, and its toggle. */
    drawerOpen: boolean;
    onToggleDrawer(): void;
    /**
     * The Code | Picture switch: present exactly while the stage shows one of the two (its box too narrow to split: always at ≤900px, and wider with the
     * Lines dock and the drawer open). `code` is whether the code pane is the one on show.
     */
    panes?: { code: boolean; onPane(code: boolean): void } | undefined;
    /**
     * Wraps the ask input so the pinpoint input catches a paste or a drop anywhere on it and puts
     * its screenshot button inside: it calls `bar` with that button.
     */
    askWrap?: ((bar: (picker: ReactNode) => ReactNode) => ReactNode) | undefined;
    /** Opens the lines as a sheet where the left panel has collapsed. */
    linesToggle?: ReactNode;
}

const icon = (id: string): ReactNode => chromeGlyph(id);

export function Toolbar({ labels, onSearch, question, askName, wrapped, outTo, onOut, spine, action, drawerOpen, onToggleDrawer, panes, askWrap, linesToggle }: ToolbarProps) {
    // null = nothing typed. The input is in the row only while asking (the search button expands it), except where the row wraps: the button is gone there, so the input stays.
    const [typed, setTyped] = useState<string | null>(null);
    const [asking, setAsking] = useState(false);
    const s = labels.surface;
    const sentence = fillTemplate(s.askSentence[question], { name: askName });
    const q = typed ?? '';
    const showAsk = asking || wrapped;
    const outLabel = outTo ? fillTemplate(s.overlay.outTo, { name: outTo }) : s.header.topLevel;
    const bar = (picker: ReactNode) => (
        <form
            role="search" onSubmit={(e) => { e.preventDefault(); onSearch(q); }}
            onKeyDown={(e) => { if (e.key === 'Escape' && !wrapped) { e.stopPropagation(); setAsking(false); } }}
            style={{
                flex: wrapped ? '1 1 120px' : '0 1 260px', width: wrapped ? undefined : 260, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, boxSizing: 'border-box',
                height: 'calc(var(--kg-control, 40px) - 2px)', padding: '0 4px 0 10px', borderRadius: 4, border: `1px solid ${cssVar('border')}`, background: cssVar('bg'),
            }}
        >
            <input
                type="search" aria-label={labels.searchLabel} placeholder={sentence} value={q} autoFocus={asking && !wrapped}
                onChange={(e) => setTyped(e.target.value)}
                style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: cssVar('text'), font: 'inherit', ...TYPE.input }}
            />
            {picker}
        </form>
    );
    const ask = askWrap ? askWrap(bar) : bar(null);
    const row: CSSProperties = wrapped
        ? { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px', padding: '6px 10px' }
        : { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', minHeight: 38, padding: '0 8px' };
    const right: CSSProperties = wrapped
        ? { display: 'flex', alignItems: 'center', gap: 2, flex: 1, justifyContent: 'flex-end', flexWrap: 'wrap', minWidth: 0 }
        : { display: 'flex', alignItems: 'center', gap: 2, marginInlineStart: 'auto', minWidth: 0 };
    const panelsName = s.panelsLabel;
    const iconBtn = (label: string, on: boolean) => ({ 'aria-label': label, title: label, style: ghostButtonStyle(on, true) });
    return (
        <div data-testid="kg-header" style={{ ...row, boxSizing: 'border-box', flex: 'none', minWidth: 0, borderBottom: `1px solid ${cssVar('border')}`, background: cssVar('panel') }}>
            <button
                type="button" data-testid="kg-out" disabled={!outTo || !onOut} onClick={onOut} aria-label={outLabel} title={outLabel}
                style={{ ...ghostButtonStyle(false, true), opacity: !outTo || !onOut ? 0.45 : 1, cursor: !outTo || !onOut ? 'default' : 'pointer' }}
            >{icon('out')}</button>
            <div style={wrapped ? { order: 3, flexBasis: '100%', minWidth: 0, display: 'flex' } : { minWidth: 0, display: 'flex', flex: '0 1 auto' }}>{spine}</div>
            <div style={right}>
                {panes && (
                    <Seg
                        label={s.header.panesLabel} value={panes.code ? 'code' : 'picture'} onPick={(id) => panes.onPane(id === 'code')}
                        items={[{ id: 'code', label: s.header.paneCode, labelled: true }, { id: 'picture', label: s.header.panePicture, labelled: true }]}
                    />
                )}
                {linesToggle}
                {showAsk ? ask : null}
                {!wrapped && (
                    <button type="button" data-testid="kg-search-button" aria-expanded={asking} onClick={() => setAsking((v) => !v)} {...iconBtn(labels.searchLabel, asking)}>{icon('search')}</button>
                )}
                {action}
                <button type="button" data-testid="kg-panels-button" aria-expanded={drawerOpen} onClick={onToggleDrawer} {...iconBtn(panelsName, drawerOpen)}>{icon('panels')}</button>
            </div>
        </div>
    );
}
