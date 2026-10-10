import { memo, useCallback, useRef, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { ComposerMenu, MenuRow } from './ComposerMenu';
import type { ComposerAddMenuItem } from './types';

/**
 * The composer's `+`: a hidden file picker plus a Claude-style menu (Upload, Add
 * context, the host's rows such as Starting points, Browse the web). Each row is
 * offered only when its host wires it, and the menu renders nothing when no row is.
 */
export const ComposerAddMenu = memo(function ComposerAddMenu({ onAttach, onAddContext, items, webBrowsing, onWebBrowsingChange, disabled }: {
  onAttach?: (file: File) => void | Promise<void>;
  onAddContext?: () => void;
  /** Host rows, after the built-in ones. */
  items?: readonly ComposerAddMenuItem[];
  webBrowsing?: boolean;
  onWebBrowsingChange?: (on: boolean) => void;
  disabled: boolean;
}) {
  const t = useTranslations('chatInput');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAttachClick = useCallback(() => {
    if (disabled || !onAttach) return;
    fileInputRef.current?.click();
  }, [disabled, onAttach]);

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (onAttach) void (async () => {
        for (const file of files) await onAttach(file);
      })();
      e.target.value = '';
    },
    [onAttach]
  );

  if (!onAttach && !onAddContext && !items?.length && !onWebBrowsingChange) return null;
  return (
    <>
      {onAttach && <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.md,.csv,.tsv,.json,.docx,.rtf,.xlsx,.pptx"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />}
      {/* `+` becomes a Claude-style menu: Upload, Add context, Browse the web. */}
      <ComposerMenu title={t('add')} disabled={disabled} trigger={<Icon name="plus" size={19} />}>
        {(close) => (
          <>
            {onAttach && <MenuRow icon="💻" label={t('upload')} onClick={() => { close(); handleAttachClick(); }} />}
            {onAddContext && <MenuRow icon="◧" label={t('addContext')} onClick={() => { close(); onAddContext(); }} />}
            {items?.map((item) => (
              <MenuRow key={item.id} icon={item.icon} label={item.label} onClick={() => { close(); item.onSelect(); }} />
            ))}
            {onWebBrowsingChange && (
              <MenuRow
                icon="🌐"
                label={t('browseWeb')}
                hint={webBrowsing ? t('on') : t('off')}
                active={!!webBrowsing}
                onClick={() => onWebBrowsingChange(!webBrowsing)}
              />
            )}
          </>
        )}
      </ComposerMenu>
    </>
  );
});
