/** Files waiting to go with the next message — removable until it is sent. */
import type { ComposerLabels } from './labels';

export interface ComposerAttachment {
  key: string;
  name: string;
  /** A thumbnail for an image. */
  imageUrl?: string;
}

export function AttachmentChips({ items, onRemove, labels }: {
  items: readonly ComposerAttachment[];
  onRemove: (key: string) => void;
  labels: ComposerLabels;
}) {
  if (items.length === 0) return null;
  return (
    <div className="bf-cmp-attachments">
      {items.map((a) => (
        <span key={a.key} className="bf-cmp-chip">
          {a.imageUrl && <img src={a.imageUrl} alt="" className="bf-cmp-chip__thumb" />}
          <span className="bf-cmp-chip__name">{a.name}</span>
          <button type="button" className="bf-cmp-chip__x" onClick={() => onRemove(a.key)} aria-label={`${labels.remove} ${a.name}`}>×</button>
        </span>
      ))}
    </div>
  );
}
