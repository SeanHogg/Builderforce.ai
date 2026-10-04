import { memo } from 'react';
import { useTranslations } from 'next-intl';

/** Inline "name a new project, create it, file this chat under it" form. */
export const BrainNewProjectForm = memo(function BrainNewProjectForm({ name, onNameChange, creating, onSubmit, onCancel }: {
  name: string;
  onNameChange: (name: string) => void;
  creating: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const tBrain = useTranslations('brain');
  const tCommon = useTranslations('common');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 12px', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <input
        placeholder={tBrain('newProjectPlaceholder')}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        style={{ flex: 1, padding: '8px 10px', fontSize: 'var(--font-size-small)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
      />
      <button type="button" onClick={onSubmit} disabled={!name.trim() || creating} style={{ padding: '8px 14px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
        {creating ? '…' : tBrain('createAndAssign')}
      </button>
      <button type="button" onClick={onCancel} style={{ padding: '8px 12px', fontSize: 'var(--font-size-small)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>{tCommon('cancel')}</button>
    </div>
  );
});
