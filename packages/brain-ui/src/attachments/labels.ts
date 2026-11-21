/**
 * The copy of the attachment preview (`AttachmentPreview`) — the same strings wherever a
 * picture or file is opened: a transcript turn's attachments and the composer's chips.
 *
 * Hosts supply it through their ONE catalog lookup under the `attachmentPreview.` scope —
 * the composer's (`brainComposerLabelsFrom`) and the transcript's (`timelineLabelsFrom`)
 * both read the same keys, so each host keeps one copy of these strings.
 * No placeholders: an accessible name is composed as `<label>: <file name>`.
 */
import { stringsFrom, type LabelLookup } from '../labelCatalog';

export interface AttachmentPreviewLabels {
  /** The trigger's accessible name, before the file name ("Open preview: shot.png"). */
  open: string;
  /** The preview panel's accessible name, before the file name. */
  dialog: string;
  close: string;
  download: string;
  downloading: string;
  /** After the host saved the file. */
  downloaded: string;
  /** Shown when the download failed and the host gave no reason. */
  downloadFailed: string;
  /** In place of a picture for a file the preview cannot show. */
  noPreview: string;
  /** The name of a picture stored without one. */
  image: string;
  /** When no copy of the file is reachable to download (e.g. a link that expired). */
  unavailable: string;
}

export const DEFAULT_ATTACHMENT_PREVIEW_LABELS: AttachmentPreviewLabels = {
  open: 'Open preview',
  dialog: 'Attachment preview',
  close: 'Close preview',
  download: 'Download',
  downloading: 'Downloading…',
  downloaded: 'Saved',
  downloadFailed: 'Download failed',
  noPreview: 'No preview for this kind of file',
  image: 'Image',
  unavailable: 'This file is no longer available to download',
};

export function attachmentPreviewLabels(overrides?: Partial<AttachmentPreviewLabels>): AttachmentPreviewLabels {
  return overrides ? { ...DEFAULT_ATTACHMENT_PREVIEW_LABELS, ...overrides } : DEFAULT_ATTACHMENT_PREVIEW_LABELS;
}

/** The preview's copy from a host lookup over its canonical keys (the field names). */
export function attachmentPreviewLabelsFrom(lookup: LabelLookup): AttachmentPreviewLabels {
  return stringsFrom(DEFAULT_ATTACHMENT_PREVIEW_LABELS, lookup);
}
