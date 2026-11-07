/**
 * The import offer "Translate to <locale>" (PRD 42 · E2): after a document lands on the
 * board, a different language than the viewer's is noticed (on device — nothing is sent) and
 * ONE explicit click translates the document's prose. Nothing is translated, and nothing is
 * detected through the cloud, without that click.
 *
 * The translation becomes a NEW document next to the original, which is left exactly as it
 * was imported (a text or markdown import keeps no source bytes, and the person may already
 * have edited it). Offers queue, so several imports each get their own one; the board's
 * notice surface shows the head of the queue.
 */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { detectForeignLanguage, languageDisplayName, translateWithEngines, useTranslationContext } from '@seanhogg/builderforce-brain-ui';
import type { ImportedCanvasObject } from '@/domains/canvas/application/ImportCanvasFile';
import { languageSample, translatableMarkdown, translateImportedDocument } from '@/domains/canvas/application/TranslateImportedDocument';
import { newNode } from '../canvasNodeHelpers';
import { canvasNodeDimensions } from '../creationCanvasLayout';
import { IMPORT_COLUMN_GAP } from '../canvasFileDrop';
import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';

export interface ImportTranslationOffer {
  nodeId: string;
  /** The detected source language code. */
  from: string;
  object: ImportedCanvasObject;
}

export type ImportTranslationStatus = 'offered' | 'working' | 'failed';

type PlaceAppended = (current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[];

/**
 * The translation as a document node beside `original` (to its right, then through the
 * canvas's ONE placer so it never lands on top of anything). Null when the original is gone.
 */
export function translationNodeFor(
  current: readonly CreationFlowNode[],
  originalId: string,
  translated: ImportedCanvasObject,
  languageName: string,
  place: PlaceAppended,
): CreationFlowNode | null {
  const original = current.find((node) => node.id === originalId);
  if (!original) return null;
  const { width } = canvasNodeDimensions(original);
  const node = newNode(translated.kind, { x: original.position.x + width + IMPORT_COLUMN_GAP / 4, y: original.position.y });
  const title = typeof translated.data['title'] === 'string' && translated.data['title'] ? translated.data['title'] : String(original.data.title ?? '');
  node.data = { ...node.data, ...translated.data, title: title ? `${title} (${languageName})` : languageName } as CreationNodeData;
  return place(current, [node])[0] ?? node;
}

export function useCanvasImportTranslation(setNodes: Dispatch<SetStateAction<CreationFlowNode[]>>, placeAppendedRef: RefObject<PlaceAppended>) {
  const ctx = useTranslationContext();
  const ctxRef = useRef(ctx);
  useEffect(() => { ctxRef.current = ctx; }, [ctx]);
  const [offers, setOffers] = useState<ImportTranslationOffer[]>([]);
  const [status, setStatus] = useState<ImportTranslationStatus>('offered');
  const offer = offers[0] ?? null;

  /** Called with each imported object once it has landed; offers only when it is foreign prose. */
  const offerFor = useCallback(async (nodeId: string, object: ImportedCanvasObject) => {
    const wiring = ctxRef.current;
    const markdown = translatableMarkdown(object);
    // Detection is on-device only; with no translator reachable at all there is nothing to offer.
    if (!wiring || !markdown || !wiring.tasks) return;
    const verdict = await detectForeignLanguage(wiring, languageSample(markdown));
    if (!verdict.foreign) return;
    setOffers((queue) => [...queue, { nodeId, from: verdict.lang, object }]);
  }, []);

  const next = useCallback(() => { setStatus('offered'); setOffers((queue) => queue.slice(1)); }, []);

  const accept = useCallback(async () => {
    const wiring = ctxRef.current;
    if (!offer || !wiring) return;
    setStatus('working');
    const translated = await translateImportedDocument(offer.object, async (texts) => {
      const result = await translateWithEngines(wiring, texts, offer.from);
      return result.ok ? result.texts : null;
    });
    if (!translated) { setStatus('failed'); return; }
    const languageName = languageDisplayName(wiring.locale, wiring.locale);
    setNodes((current) => {
      const created = translationNodeFor(current, offer.nodeId, translated, languageName, placeAppendedRef.current!);
      return created ? [...current, created] : current;
    });
    next();
  }, [offer, setNodes, placeAppendedRef, next]);

  return { offer, status, offerFor, accept, dismiss: next, locale: ctx?.locale ?? '' };
}
