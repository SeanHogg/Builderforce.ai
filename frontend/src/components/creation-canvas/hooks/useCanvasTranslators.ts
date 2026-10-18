import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import type { ImportTranslator } from '@/domains/canvas/application/ImportCanvasFile';
import { canvasNoticesFrom } from '@/lib/canvasNotices';
import type { CreationTemplate } from '@/lib/templates/creationTemplates';

/**
 * Every translator the canvas hands to code that cannot translate for itself — the plain
 * use-case modules, the import engine, the turn runner — built ONCE, beside the namespaces
 * the board's own components read.
 */
export function useCanvasTranslators() {
  const t = useTranslations('creationCanvas');
  /**
   * The plain-module translator. Three places had written the same cast inline — the
   * materialisation deps, the card-act runner and the shared room — because
   * `useTranslations` returns a key-typed function and `CanvasTextTranslator` is the
   * widened seam a use case takes (see `domains/canvas/domain/canvasText.ts`).
   */
  const canvasText = useMemo<CanvasTextTranslator>(
    () => (key, values) => t(key as never, values as never),
    [t],
  );
  // The proposal stage is built once, so it reads the CURRENT translator through a
  // ref — a new object's default title is persisted in the board's language.
  const canvasTextRef = useRef(canvasText);
  useEffect(() => { canvasTextRef.current = canvasText; }, [canvasText]);
  /** A turn's runtime notices, already in the viewer's language: the turn runner is not
   *  a component and cannot translate for itself. */
  const noticeText = useTranslations('creationCanvas.notice');
  const canvasNotices = useMemo(() => canvasNoticesFrom(noticeText), [noticeText]);
  /** A shipped pack's name and blurb are product copy, so they come from the catalogs;
   *  the English in `creationTemplates.ts` is the source string and the last-resort
   *  fallback while a new pack's translations land. */
  const templateText = useCallback((template: CreationTemplate, field: 'name' | 'description') => {
    const key = `template.${template.id}.${field}`;
    return t.has(key) ? t(key) : template[field];
  }, [t]);
  const tMiro = useTranslations('creationCanvas.miro');
  const tSocial = useTranslations('creationCanvas.social');
  // The step catalog names itself out of the builder's namespace — the same keys the
  // standalone palette reads, because they name the same steps.
  const tStep = useTranslations('evermindBuild');
  // The facilitation vocabulary. Its own namespace because the SAME strings are read by
  // the participant's page — which is not a canvas at all.
  const tPoll = useTranslations('poll');
  /** The import engine is a plain module, so it is handed the catalog rather than
   *  reaching for one — every string it produces stays translated. */
  const tImport = useTranslations('creationCanvas.import');
  const importLabel = useCallback<ImportTranslator>((key, values) => tImport(key as never, values as never), [tImport]);
  return { t, canvasText, canvasTextRef, canvasNotices, templateText, tMiro, tSocial, tStep, tPoll, importLabel };
}
