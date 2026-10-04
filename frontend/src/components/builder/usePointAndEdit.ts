// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { saveFile, fetchFileContent } from '@/lib/api';
import { validateFileContentForPath } from '@builderforce/ide-file-contract';
import { previewErrorFrom, recordBuildFailure } from '@/lib/buildDiagnostics';
import {
  VISUAL_ARM_MESSAGE,
  replaceClassNameAtLine,
  replaceTextAtLine,
  visualSelectionFrom,
  type VisualSelection,
} from '@/lib/visualEditor';
import { faultMessage } from '@/lib/apiClient';

export interface PointAndEditDraft {
  text: string;
  className: string;
}

/**
 * The host half of the preview conversation.
 *
 * Two kinds of message come back from the overlay injected into the mounted
 * preview (`lib/visualEditor.ts`, `lib/buildDiagnostics.ts`): a runtime error
 * thrown inside the app — recorded so the agent can read it — and an element the
 * person pointed at, which opens a two-field edit (copy, classes) applied as an
 * exact single-line source change. No model turn, no tokens.
 *
 * `event.source` is deliberately not checked against the preview iframe: the
 * dev server is a cross-origin document whose `contentWindow` this frame cannot
 * compare, so the message TYPE plus the shape checks are the identification.
 * Both are namespaced, and the payload is only ever read as strings, so a
 * hostile sender's best case is a spurious diagnostic line.
 */
export function usePointAndEdit({ projectId, previewUrl, writePreviewFile, setFileContents }: {
  projectId: number;
  previewUrl: string | undefined;
  writePreviewFile: (path: string, contents: string) => Promise<void>;
  setFileContents: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const t = useTranslations('ide');
  // Cross-origin preview: postMessage through this window is the only channel.
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [armed, setArmed] = useState(false);
  const [selection, setSelection] = useState<VisualSelection | null>(null);
  const [draft, setDraft] = useState<PointAndEditDraft>({ text: '', className: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!previewUrl) return undefined;
    const onMessage = (event: MessageEvent) => {
      const failure = previewErrorFrom(event.data);
      if (failure) { recordBuildFailure(projectId, failure); return; }
      const selected = visualSelectionFrom(event.data);
      if (selected) { setSelection(selected); setDraft({ text: selected.text ?? '', className: selected.className }); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [previewUrl, projectId]);

  const arm = useCallback((next: boolean) => {
    setArmed(next);
    if (!next) setSelection(null);
    frameRef.current?.contentWindow?.postMessage({ type: VISUAL_ARM_MESSAGE, armed: next }, '*');
  }, []);

  // Re-arm after a reload: the overlay is a fresh script in a fresh document and
  // has no memory of having been armed before the dev server restarted it.
  useEffect(() => {
    if (!armed || !previewUrl) return undefined;
    const id = window.setTimeout(
      () => frameRef.current?.contentWindow?.postMessage({ type: VISUAL_ARM_MESSAGE, armed: true }, '*'),
      400,
    );
    return () => window.clearTimeout(id);
  }, [armed, previewUrl]);

  const apply = useCallback(async () => {
    if (!selection) return;
    setError(null);
    try {
      let content = await fetchFileContent(projectId, selection.file);
      if (selection.text !== null && draft.text !== selection.text) {
        const edited = replaceTextAtLine(content, selection.line, selection.text, draft.text);
        if (!edited.ok) { setError(edited.reason); return; }
        content = edited.content;
      }
      if (draft.className !== selection.className) {
        const edited = replaceClassNameAtLine(content, selection.line, draft.className);
        if (!edited.ok) { setError(edited.reason); return; }
        content = edited.content;
      }
      const valid = validateFileContentForPath(selection.file, content);
      if (!valid.ok) { setError(valid.reason); return; }
      await saveFile(projectId, selection.file, content);
      setFileContents((prev) => ({ ...prev, [selection.file]: content }));
      if (previewUrl) await writePreviewFile(selection.file, content).catch(() => { /* best-effort */ });
      setSelection(null);
    } catch (e) {
      setError(faultMessage(e, t('visualNoPreview')));
    }
  }, [projectId, previewUrl, t, draft, selection, writePreviewFile, setFileContents]);

  const cancel = useCallback(() => {
    setSelection(null);
    setError(null);
  }, []);

  return { frameRef, armed, arm, selection, draft, setDraft, error, apply, cancel };
}

export type PointAndEdit = ReturnType<typeof usePointAndEdit>;
