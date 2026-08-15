/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components. Its own
 * header says it: the directive is sometimes the bug.
 */
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import { CanvasObjectSurface } from './CanvasObjectSurface';
import { CanvasResumeEditor, type ResumeShareActions } from './CanvasResumeEditor';
import { DocumentEditor } from './DocumentEditor';
import { authoredMarkdown } from '@/lib/canvasDocuments';
import type { CreationNodeData } from './types';

/**
 * A document at the size it is actually read — the page runtime.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────────
 * A résumé, a PRD and a knowledge article were all authored inside a ~340px node body.
 * That card is the right size to RECOGNISE a document and the wrong size to write one:
 * the medium's own axis is a page, and a page does not fit in a card. So the editors were
 * already there — `DocumentEditor` and `CanvasResumeEditor` — just never given the room
 * their content assumes. This surface is that room; it introduces no new editor.
 *
 * ── WHY THE PAGE IS A FIXED MEASURE AND NOT FULL-BLEED ───────────────────────────
 * A document has a column because prose has a comfortable line length; stretching it to a
 * 2560px monitor would make the surface technically larger and practically worse. The
 * sheet therefore keeps a page measure and centres, which is also what makes what you see
 * here resemble what comes out of an export.
 */

export interface CanvasPageSurfaceProps {
  data: CreationNodeData;
  onExit: () => void;
  /** Absent on a board the viewer cannot drive, which makes the page read-only. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
  onTailor?: (prompt: string) => void;
  onDetach?: (patch: Partial<CreationNodeData>) => void;
  shareActions?: ResumeShareActions;
}

export function CanvasPageSurface({ data, onExit, onEdit, onTailor, onDetach, shareActions }: CanvasPageSurfaceProps) {
  const t = useTranslations('creationCanvas');

  return (
    <CanvasObjectSurface surface="page" data={data} onExit={onExit}>
      <div className={styles.pageSheet}>
        {data.kind === 'resume'
          ? <CanvasResumeEditor
            data={data}
            {...(onEdit ? { onEdit } : {})}
            {...(onTailor ? { onTailor } : {})}
            {...(onDetach ? { onDetach } : {})}
            {...(shareActions ? { shareActions } : {})}
          />
          : onEdit
            // `authoredMarkdown` is the SAME reader the node body uses, so a document
            // opened here and the same document previewed on the board can never
            // disagree about which of `content` / `markdown` / `code` is the body.
            ? <DocumentEditor
              markdown={authoredMarkdown(data) ?? ''}
              label={String(data.title ?? '')}
              onCommit={(markdown) => onEdit({ markdown, content: markdown })}
            />
            : <p className={styles.pageSheetReadOnly}>{t('roleCannotEdit')}</p>}
      </div>
    </CanvasObjectSurface>
  );
}
