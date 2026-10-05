/*
 * No `'use client'` — imported only from `BrainSurfaceActions`, inside the canvas's own
 * client boundary. See the `use-client-is-a-declaration` rule.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AnchoredPopover } from '@/components/ui/AnchoredPopover';
import { Icon, type IconName } from '@/components/ui/Icon';
import { usePhoneViewport } from '@/lib/usePhoneViewport';
import styles from './CreationCanvas.module.css';
import { useCanvasSurfaceDefinition } from './canvasSurfaceContext';
import type { BrainSurfaceActionsProps } from './BrainSurfaceActions';

/** The props the menu reads — the surface's own, minus the ones the header keeps. */
export type BrainSurfaceMenuProps = Omit<BrainSurfaceActionsProps, 'onClose'>;

/**
 * THE BRAIN SURFACE'S "MORE" MENU — every control that configures the panel rather than
 * the conversation, each with its name written out.
 *
 * These used to be six glyph buttons in the header (`⋮⋮ ▣ ⇤ ⇥ ⤢` and the float-prompt
 * arrow) beside copy and close: seven unlabelled icons before the first message. They are
 * placement and display settings, used rarely, so they are rows in one menu where each
 * says what it does. The header keeps only Context, Copy diagnostics and Close.
 *
 * It decides for itself which rows apply, as the header always did: edge side and width
 * are meaningless for the Brain Object (its own handles size it), moving into the Brain
 * Object is withheld while no board is on screen, and the side switch is withheld on a
 * phone, where the panel is a bottom sheet with no edge to choose. Nothing left to offer
 * means no menu.
 */
export function BrainSurfaceMenu({
  mode, showExecutionDetail, onModeChange, onExecutionDetailChange,
  side, size, onSideChange, onSizeChange, onUndockPrompt,
}: BrainSurfaceMenuProps) {
  const t = useTranslations('creationCanvas');
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const boardAvailable = useCanvasSurfaceDefinition().showsBoard;
  const phone = usePhoneViewport();
  const inline = mode === 'inline';
  const expanded = size === 'expanded';
  const edge = !inline && !!side && !!onSideChange && !!onSizeChange;

  const choose = (action: () => void) => () => { setOpen(false); action(); };
  const row = (key: string, icon: IconName, label: string, onClick: () => void, checked?: boolean): ReactNode => (
    <button
      key={key}
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      {...(checked === undefined ? {} : { 'aria-checked': checked })}
      className={styles.brainMenuItem}
      onClick={choose(onClick)}
    >
      <Icon name={icon} size={15} />
      <span>{label}</span>
      {checked && <Icon name="check" size={14} />}
    </button>
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('brainMenu.label')}
        title={t('brainMenu.label')}
        onClick={() => setOpen((current) => !current)}
      ><Icon name="more-horizontal" size={16} /></button>
      <AnchoredPopover open={open} anchorRef={anchorRef} onDismiss={() => setOpen(false)} placement="below" align="end">
        <div role="menu" aria-label={t('brainMenu.label')} className={styles.brainMenu}>
          {row('steps', 'activity', t('brainMenu.executionSteps'), () => onExecutionDetailChange(!showExecutionDetail), showExecutionDetail)}
          {onUndockPrompt && row('float', 'external-link', t('floatPrompt'), onUndockPrompt)}
          {boardAvailable && row(
            'placement',
            inline ? 'collapse-horizontal' : 'canvas',
            inline ? t('dockBrainToEdge') : t('showBrainInObject'),
            () => onModeChange(inline ? 'docked' : 'inline'),
          )}
          {edge && !phone && <>
            <div className={styles.brainMenuSep} role="separator" />
            {row('left', 'chevron-left', t('dockBrainLeft'), () => onSideChange!('left'), side === 'left')}
            {row('right', 'chevron-right', t('dockBrainRight'), () => onSideChange!('right'), side === 'right')}
          </>}
          {edge && row('size', expanded ? 'collapse-horizontal' : 'expand-horizontal', expanded ? t('slimBrain') : t('expandBrain'), () => onSizeChange!(expanded ? 'slim' : 'expanded'))}
        </div>
      </AnchoredPopover>
    </>
  );
}
