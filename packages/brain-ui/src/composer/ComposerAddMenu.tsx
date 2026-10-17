/**
 * The composer's `+`: upload, add context, browse the web, and any host rows (e.g. the
 * web's Starting points). Each built-in row is offered only when its host wires it, and
 * the menu renders nothing when no row is.
 */
import { useRef, type ChangeEvent, type ReactNode } from 'react';
import { usePopover } from '../popover/usePopover';
import { IconPlus } from './ComposerIcons';
import type { ComposerLabels } from './labels';

export interface ComposerAddMenuItem {
  id: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
}

export interface ComposerAddMenuProps {
  labels: ComposerLabels;
  disabled?: boolean;
  /** Files picked from the computer. */
  onAttachFiles?: (files: File[]) => void;
  uploading?: boolean;
  /** File types the picker offers. */
  accept?: string;
  onAddContext?: () => void;
  webBrowsing?: { on: boolean; onChange: (on: boolean) => void };
  items?: readonly ComposerAddMenuItem[];
}

export function ComposerAddMenu({ labels, disabled = false, onAttachFiles, uploading = false, accept, onAddContext, webBrowsing, items }: ComposerAddMenuProps) {
  const { open, toggle, close, rootRef } = usePopover<HTMLDivElement>();
  const fileRef = useRef<HTMLInputElement>(null);
  if (!onAttachFiles && !onAddContext && !webBrowsing && !items?.length) return null;
  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length && onAttachFiles) onAttachFiles(files);
    e.target.value = '';
  };
  const row = (key: string, icon: ReactNode, label: string, onClick: () => void, hint?: string, active?: boolean) => (
    <button key={key} type="button" role="menuitem" className={`bf-pmenu__item${active ? ' is-active' : ''}`} onClick={onClick}>
      <span className="bf-pmenu__ico" aria-hidden="true">{icon}</span>
      <span className="bf-pmenu__lbl">{label}</span>
      {hint != null && <span className="bf-pmenu__hint">{hint}</span>}
    </button>
  );
  return (
    <div className="bf-pmenu" ref={rootRef}>
      {onAttachFiles && <input ref={fileRef} type="file" multiple hidden accept={accept} onChange={onFiles} />}
      <button
        type="button"
        className={`bf-cmp-iconbtn${open ? ' is-active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={labels.add}
        aria-label={labels.add}
        disabled={disabled}
        onClick={toggle}
      >
        <IconPlus />
      </button>
      {open && (
        <div className="bf-pmenu__pop" role="menu">
          {onAttachFiles && row('upload', '💻', uploading ? labels.uploading : labels.upload, () => { close(); if (!uploading) fileRef.current?.click(); })}
          {onAddContext && row('context', '◧', labels.addContext, () => { close(); onAddContext(); })}
          {items?.map((item) => row(item.id, item.icon, item.label, () => { close(); item.onSelect(); }))}
          {webBrowsing && row('web', '🌐', labels.browseWeb, () => webBrowsing.onChange(!webBrowsing.on), webBrowsing.on ? labels.on : labels.off, webBrowsing.on)}
        </div>
      )}
    </div>
  );
}
