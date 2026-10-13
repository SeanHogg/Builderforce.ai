/**
 * A compiled improvement prompt (PRD 33 §5.2 "Prompt"), read-only, with ONE Copy
 * button (`useCopyToClipboard`). The text is compiled by the API on read and never
 * stored; after a successful copy `onCopied` records it (the `copy-prompt` action
 * marks the fixes applied by hand, so the next release is measured against them).
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { useErrorText } from '@/i18n/useErrorMessage';
import { Icon } from '@/components/ui/Icon';

export interface PromptBoxProps {
  prompt: string;
  /** After a successful copy: record it (errors are said under the box). */
  onCopied?: () => Promise<void>;
  /** Rows of the read-only text. */
  rows?: number;
}

export function PromptBox({ prompt, onCopied, rows = 12 }: PromptBoxProps) {
  const t = useTranslations('replay.prompt');
  const errorText = useErrorText();
  const { copy, state } = useCopyToClipboard();
  const [note, setNote] = useState<{ text: string; tone: 'status' | 'alert' } | null>(null);

  const press = async () => {
    setNote(null);
    if (!(await copy(prompt))) {
      setNote({ text: t('copyFailed'), tone: 'alert' });
      return;
    }
    if (!onCopied) return;
    try {
      await onCopied();
      setNote({ text: t('markedApplied'), tone: 'status' });
    } catch (failure) {
      setNote({ text: errorText(failure), tone: 'alert' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <textarea
        className="input"
        readOnly
        rows={rows}
        value={prompt}
        aria-label={t('textAria')}
        data-testid="improvement-prompt"
        style={{ width: '100%', minHeight: 120, resize: 'vertical', fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--font-size-small)', background: 'var(--surface)', color: 'var(--text-primary)' }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button type="button" className="btn-primary" style={{ minHeight: 44 }} onClick={() => void press()}>
          <Icon name={state === 'copied' ? 'check' : 'copy'} size={14} /> {state === 'copied' ? t('copied') : t('copy')}
        </button>
        {note && (
          <p role={note.tone} style={{ margin: 0, fontSize: 'var(--font-size-small)', color: note.tone === 'alert' ? 'var(--error)' : 'var(--text-secondary)' }}>
            {note.text}
          </p>
        )}
      </div>
    </div>
  );
}
