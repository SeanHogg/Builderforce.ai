import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { listStarterKits } from '@builderforce/ide-templates/kits';
import styles from './CreationLibrary.module.css';

const kits = listStarterKits();

export function StarterKitPicker({ disabled, onStart }: {
  disabled: boolean;
  onStart: (kit: (typeof kits)[number]) => void;
}) {
  const t = useTranslations('creationCanvas');
  const [kitId, setKitId] = useState('');
  const selected = kits.find((kit) => kit.value === kitId);
  return (
    <div className={styles.starterKitPicker}>
      <label>
        {t('starterKitLabel')}{' '}
        <select value={kitId} disabled={disabled} onChange={(event) => setKitId(event.currentTarget.value)}>
          <option value="">{t('starterKitPlaceholder')}</option>
          {kits.map((kit) => <option key={kit.value} value={kit.value}>{kit.label}</option>)}
        </select>
      </label>
      <button type="button" disabled={disabled || !selected} onClick={() => { if (selected) onStart(selected); }}>
        {t('createAction')}
      </button>
    </div>
  );
}
