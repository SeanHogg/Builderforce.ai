/**
 * The stray-copy card (PRD 41 A9 rule 2): which folder looks like a stray copy of which, and why, with
 * *Exclude from review*. The fix is the product's: it records the folder in the root's ignore file
 * (`source.folders.exclude`) and starts the normal plan, estimate, confirm Re-review. Nothing is done
 * to the folder itself. The component draws nothing when the host cannot exclude, and the button is
 * disabled while a review is in flight (a second review of the same root must not start).
 */

import { useState } from 'react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { smallButton } from '../ActCards';
import { Card } from '../ui';
import { TYPE } from '../ui/type';
import { copyFileRefs, duplicateCopyOf, reasonText } from './duplicateCopy';

export interface CopyFix {
    /** Appends the folder to the root's ignore file. */
    exclude(copy: string): Promise<void>;
    /** Starts the normal Re-review once the folder is excluded. */
    rereview(): void;
    /** A review is planning, awaiting confirmation or running. */
    busy: boolean;
}

export interface DuplicateCopyCardsProps {
    findings: readonly Finding[];
    labels: KnowledgeGraphLabels;
    /** Absent ⇒ the host cannot exclude a folder: nothing is drawn. */
    fix?: CopyFix | undefined;
    /** The graph, so Show lights the copy's FILES (the finding's own refs are folders). Absent ⇒ the finding's refs. */
    graph?: KnowledgeGraph | undefined;
    onShow(refs: string[]): void;
}

export function DuplicateCopyCards({ findings, labels, fix, graph, onShow }: DuplicateCopyCardsProps) {
    const [pending, setPending] = useState<string | null>(null);
    const [failed, setFailed] = useState<{ copy: string; message: string } | null>(null);
    if (!fix) return null;
    const t = labels.surface.duplicateCopy;
    const copies = findings.flatMap((f) => duplicateCopyOf(f) ?? []);
    if (copies.length === 0) return null;
    const locked = fix.busy || pending !== null;
    const showRefs = (c: { copy: string; nodes: string[] }): string[] => {
        const files = graph ? copyFileRefs(graph, c.copy) : [];
        return files.length > 0 ? files : c.nodes;
    };

    const exclude = async (copy: string) => {
        setPending(copy);
        setFailed(null);
        try {
            await fix.exclude(copy);
            fix.rereview();
        } catch (e) {
            // The host's refusal is already in the person's language: show it, else the generic line.
            setFailed({ copy, message: e instanceof Error && e.message ? e.message : t.failed });
        } finally {
            setPending(null);
        }
    };

    return (
        <>
            {copies.map((c) => (
                <Card as="section" key={c.id} label={t.title} style={{ display: 'grid', gap: 6 }}>
                    <div data-copy-card={c.copy} style={{ display: 'grid', gap: 6 }}>
                        <strong style={{ ...TYPE.bodyLarge, fontWeight: 700, overflowWrap: 'anywhere' }}>{t.title}</strong>
                        <p style={{ ...TYPE.body, margin: 0, overflowWrap: 'anywhere' }}>{fillTemplate(t.body, { copy: c.copy, original: c.original, similarity: c.similarity })}</p>
                        <p data-copy-reason={c.reason} style={{ ...TYPE.body, margin: 0 }}>{reasonText(c.reason, labels)}</p>
                        <p style={{ ...TYPE.meta, margin: 0 }}>{t.note}</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                                type="button" data-act="exclude-copy" disabled={locked} aria-busy={pending === c.copy}
                                aria-label={fillTemplate(t.excludeAria, { copy: c.copy })}
                                style={{ ...smallButton, background: cssVar('accent'), color: cssVar('onAccent'), borderColor: cssVar('accent'), opacity: locked ? 0.5 : 1 }}
                                onClick={() => void exclude(c.copy)}
                            >
                                {pending === c.copy ? t.excluding : t.exclude}
                            </button>
                            <button type="button" data-act="show-copy" style={smallButton} onClick={() => onShow(showRefs(c))}>{labels.surface.act.show}</button>
                        </div>
                        {failed?.copy === c.copy && <p role="alert" style={{ ...TYPE.meta, margin: 0, color: cssVar('errorText') }}>{failed.message}</p>}
                    </div>
                </Card>
            ))}
        </>
    );
}
