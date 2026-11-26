/**
 * The call-site card (PRD 43 B1a rule 10, Code band): picking a Sequence message (a link whose batch carries
 * `callSites[group]`) shows where the call is made — `path:line` — in the ONE note-card shell docked at the stage's
 * top-left (`NoteCard`), with "Open at line" through the host's ONE open port (`SceneProps.onOpenSource`, the same
 * `SourceLocation` the findings' evidence opens). No port, no button: the location is still shown. Themed by tokens,
 * closed by its × or Escape, and closed by the wiring when another placement comes on show or a mark is selected.
 */

import { useEffect, useRef } from 'react';
import type { CallSite } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { CardAction } from '../../surface/transit/CardActions';
import { NoteCard } from '../../surface/transit/NoteCard';
import { questionGlyph } from '../../surface/ui/glyphs';
import type { SourceLocation } from '../../types';

export interface CallSiteCardProps {
    site: CallSite;
    labels: KnowledgeGraphLabels;
    /** The stage box is narrow (≤ 900px): the card leaves the level rail its room. */
    narrow?: boolean | undefined;
    onOpenSource?: ((location: SourceLocation) => void) | undefined;
    onClose(): void;
}

export function CallSiteCard({ site, labels, narrow, onOpenSource, onClose }: CallSiteCardProps) {
    const t = labels.surface.map.card;
    const ref = useRef<HTMLElement>(null);
    useEffect(() => {
        ref.current?.focus({ preventScroll: true });
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
        document.addEventListener('keydown', key);
        return () => document.removeEventListener('keydown', key);
    }, [onClose]);
    const where = `${site.path}:${site.line}`;
    return (
        <NoteCard
            role="call-site" ariaLabel={`${t.callSite} ${where}`} name={where} kind={t.callSite} narrow={narrow} boxRef={ref}
            glyph={questionGlyph('callers')} close={{ label: t.close, onClose }}
            acts={onOpenSource && (
                <CardAction
                    id="open-at-line" primary label={fillTemplate(t.openAtLine, { line: site.line })}
                    onClick={() => { onOpenSource({ path: site.path, startLine: site.line, endLine: site.line }); onClose(); }}
                />
            )}
        />
    );
}
