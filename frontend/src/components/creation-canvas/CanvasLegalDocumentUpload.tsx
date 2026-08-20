// No 'use client': rendered only inside `CreationNode.tsx`'s client boundary.
import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';
import { LEGAL_DOCUMENT_CATEGORIES, uploadLegalDocumentFile, type LegalDocumentCategory } from '@/lib/legalDocumentApi';
import { useFormat } from "@/i18n/useFormat";

/** Mirrors the backend's own bound (`legalDocumentStore.ts`'s `MAX_BYTES`), so an
 *  oversized file is refused HERE rather than after a full upload attempt. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * The `legalDocument` card's upload control — the ONE real UI affordance this kind
 * needs beyond the read-only stat rows `SpecObjectBody` already draws for it.
 *
 * ── WHY THIS IS A DIRECT FETCH, NOT A BrainAction ────────────────────────────────
 * A browser `File` cannot cross the JSON tool-call boundary, so this is a real
 * button wired to a hidden `<input type="file">`, mirroring the mechanism
 * `CanvasResumeEditor.tsx` already uses for the canvas's other per-card upload:
 * pick → `FormData` POST → write the response straight onto the card through the
 * SAME `onEdit` prop every direct card edit uses (`updateNodeData` in
 * `CreationCanvas.tsx`), never through the AI proposal queue — a person picking a
 * file sees it land immediately, the same way typing in the resume editor does.
 */
export function CanvasLegalDocumentUpload({ objectId, data, onEdit }: {
  objectId: string;
  data: CreationNodeData;
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}) {
    const fmt = useFormat();
  const t = useTranslations('creationCanvas.legalUpload');
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<LegalDocumentCategory>(
    (LEGAL_DOCUMENT_CATEGORIES as readonly string[]).includes(String(data.category))
      ? (data.category as LegalDocumentCategory)
      : 'other',
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const hasFile = typeof data.artifactId === 'string' && data.artifactId.trim().length > 0;
  const existingDocumentId = typeof data.documentId === 'string' && data.documentId.trim() ? data.documentId.trim() : null;

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onEdit) return;
    if (file.size > MAX_UPLOAD_BYTES) { setError(t('tooLarge')); return; }
    setError('');
    setUploading(true);
    try {
      const title = (typeof data.title === 'string' && data.title.trim()) || file.name;
      const result = await uploadLegalDocumentFile(file, {
        title,
        category,
        objectId,
        ...(existingDocumentId ? { documentId: existingDocumentId } : {}),
      });
      onEdit({
        documentId: result.documentId,
        artifactId: result.artifactId,
        checksum: result.checksum,
        mime: file.type || null,
        byteSize: file.size,
        category,
        documentStatus: 'draft',
        status: t('statusDraft'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`${styles.legalUpload} nodrag nowheel`} onPointerDownCapture={(event) => event.stopPropagation()}>
      <input ref={input} type="file" hidden onChange={(event) => void choose(event)} accept=".pdf,.doc,.docx,.rtf,.txt,.md,.png,.jpg,.jpeg" />
      <label>
        <span>{t('category')}</span>
        <select value={category} disabled={!onEdit || uploading} onChange={(event) => setCategory(event.target.value as LegalDocumentCategory)}>
          {LEGAL_DOCUMENT_CATEGORIES.map((value) => <option key={value} value={value}>{t(`category_${value}`)}</option>)}
        </select>
      </label>
      <button type="button" disabled={!onEdit || uploading} onClick={() => input.current?.click()}>
        {uploading ? t('uploading') : hasFile ? t('replaceFile') : t('upload')}
      </button>
      {hasFile && (
        <small>
          {t('currentFile', { kb: fmt.number(Math.max(1, Math.ceil(Number(data.byteSize ?? 0) / 1024))) })}
        </small>
      )}
      {error && <p role="alert" className={styles.legalUploadError}>{error}</p>}
    </div>
  );
}
