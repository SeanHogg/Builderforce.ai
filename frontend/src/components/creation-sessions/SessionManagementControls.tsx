'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { Select } from '@/components/Select';
import { AnchoredPopover, Button, Icon, Surface, TextField, type IconName } from '@/components/ui';
import { useModalDismiss } from '@/hooks/useModalDismiss';
import styles from './SessionManagementControls.module.css';

export interface ManagedSession {
  id: string;
  title: string;
  folder?: string | null;
}

export interface SessionMenuAction {
  id: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

interface Props {
  session: ManagedSession;
  mergeCandidates?: ManagedSession[];
  onRename: (title: string) => void | Promise<void>;
  onMove: (folder: string | null) => void | Promise<void>;
  onMerge?: (sourceId: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  extraActions?: SessionMenuAction[];
  localOnly?: boolean;
}

type Editor = 'rename' | 'move' | 'merge' | null;

export function SessionManagementControls({ session, mergeCandidates = [], onRename, onMove, onMerge, onDelete, extraActions = [], localOnly = false }: Props) {
  const t = useTranslations('sessionManagement');
  const confirm = useConfirm();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useModalDismiss(editor !== null, () => setEditor(null));

  // Placement and dismissal (outside press, Escape, reflow on scroll) belong to
  // `AnchoredPopover`; this file only says WHEN the menu is open and WHAT is in it.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => {
    if (!menuOpen) return;
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus());
  }, [menuOpen]);

  const openMenu = () => setMenuOpen(true);
  const openEditor = (next: Exclude<Editor, null>) => {
    setValue(next === 'rename' ? session.title : next === 'move' ? session.folder ?? '' : mergeCandidates[0]?.id ?? '');
    setError('');
    setEditor(next);
    closeMenu();
  };
  const submit = async () => {
    if (!editor) return;
    if ((editor === 'rename' || editor === 'merge') && !value.trim()) { setError(t('required')); return; }
    setBusy(true);
    setError('');
    try {
      if (editor === 'rename') await onRename(value.trim());
      if (editor === 'move') await onMove(value.trim() || null);
      if (editor === 'merge' && onMerge) {
        const source = mergeCandidates.find((candidate) => candidate.id === value);
        if (!source) { setError(t('required')); return; }
        const approved = await confirm({
          title: t('mergeConfirmTitle'),
          message: t(localOnly ? 'mergeConfirmMessageLocal' : 'mergeConfirmMessageSaved', { source: source.title, target: session.title }),
          confirmLabel: t('merge'),
          destructive: false,
        });
        if (!approved) return;
        await onMerge(source.id);
      }
      setEditor(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    closeMenu();
    const approved = await confirm({
      title: t('deleteConfirmTitle'),
      message: t(localOnly ? 'deleteConfirmMessageLocal' : 'deleteConfirmMessageSaved', { title: session.title }),
      confirmLabel: t('delete'),
      destructive: true,
    });
    if (approved) await onDelete();
  };

  const actions: SessionMenuAction[] = [
    { id: 'rename', label: t('rename'), icon: 'edit', run: () => openEditor('rename') },
    { id: 'move', label: t('move'), icon: 'folder', run: () => openEditor('move') },
    { id: 'merge', label: t('merge'), icon: 'workflow', disabled: !onMerge || mergeCandidates.length === 0, run: () => openEditor('merge') },
    ...extraActions,
    { id: 'delete', label: t('delete'), icon: 'trash', danger: true, run: remove },
  ];

  return (
    <div className={styles.root} onClick={(event) => event.stopPropagation()}>
      <Button ref={triggerRef} type="button" variant="ghost" size="sm" className={styles.trigger} aria-label={t('actionsFor', { title: session.title })} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => menuOpen ? closeMenu() : openMenu()}>
        <Icon name="more-horizontal" size={18} />
      </Button>
      <AnchoredPopover open={menuOpen} anchorRef={triggerRef} onDismiss={closeMenu} placement="auto" align="end" gap={4} layerRef={menuRef} role="menu" className={styles.menu} onKeyDown={(event) => {
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'ArrowDown' ? (current + 1) % items.length : event.key === 'ArrowUp' ? (current - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
        }}>
          {actions.map((action) => <Button key={action.id} type="button" variant="ghost" size="sm" role="menuitem" disabled={action.disabled} className={`${styles.menuItem}${action.danger ? ` ${styles.danger}` : ''}`} onClick={() => { closeMenu(); void action.run(); }}>
            <Icon name={action.icon} size={16} />
            <span>{action.label}</span>
          </Button>)}
      </AnchoredPopover>
      {editor && typeof document !== 'undefined' && createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby={`session-${editor}-title`} onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
          <Surface tone="raised" padding="md" className={styles.dialog}>
            <header className={styles.dialogHeader}>
              <h2 id={`session-${editor}-title`}>{t(`${editor}Title`)}</h2>
              <p>{t(`${editor}Description`)}</p>
            </header>
            {editor === 'merge' ? (
              <div>
                <label className={styles.fieldLabel} htmlFor="session-merge-source">{t('mergeSource')}</label>
                <Select id="session-merge-source" className={styles.select} value={value} onChange={(event) => setValue(event.target.value)} aria-label={t('mergeSource')}>
                  {mergeCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
                </Select>
              </div>
            ) : (
              <TextField id={`session-${editor}-value`} autoFocus label={editor === 'rename' ? t('nameLabel') : t('folderLabel')} hint={editor === 'move' ? t('folderHint') : undefined} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submit(); } }} />
            )}
            {error && <p className={styles.error} role="alert">{error}</p>}
            <footer className={styles.dialogActions}>
              <Button type="button" variant="secondary" onClick={() => setEditor(null)}>{t('cancel')}</Button>
              <Button type="button" variant="primary" loading={busy} onClick={() => void submit()}>{t(editor)}</Button>
            </footer>
          </Surface>
        </div>,
        document.body,
      )}
    </div>
  );
}
