import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { replayMomentDescriptionEditor } from '@builderforce/interaction-contract';
import type { CreationNodeData } from '../types';

/**
 * The task inspector's description box.
 *
 * `data.content` holds the RAW ticket description, including the hidden replay-moment
 * trailer a ticket raised from a recording carries. The person sees and edits only the
 * text; every write re-attaches the trailer through `replayMomentDescriptionEditor`, and
 * a blur that changed nothing writes nothing — otherwise the PATCH would store the
 * stripped text and the ticket would lose its measured effect.
 */
export function TaskDescriptionField({ data, persistable, onChange, onPersist }: {
  data: CreationNodeData;
  /** True when the task exists server-side, so a finished edit is worth a PATCH. */
  persistable: boolean;
  onChange: (patch: Partial<CreationNodeData>) => void;
  onPersist: (description: string | null) => void;
}) {
  const t = useTranslations('creationCanvas');
  const editor = replayMomentDescriptionEditor(typeof data.content === 'string' ? data.content : null);
  const visible = typeof data.content === 'string' ? editor.text : typeof data.subtitle === 'string' ? data.subtitle : '';
  const valueOnFocus = useRef<string | null>(null);
  return (
    <label>{t('description')}<textarea
      rows={5}
      value={visible}
      onFocus={() => { valueOnFocus.current = visible; }}
      onChange={(event) => onChange({ content: editor.save(event.target.value) ?? '' })}
      onBlur={(event) => {
        if (!persistable || event.target.value === valueOnFocus.current) return;
        valueOnFocus.current = event.target.value;
        onPersist(editor.save(event.target.value));
      }}
    /></label>
  );
}
