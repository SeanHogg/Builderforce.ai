import { useTranslations } from 'next-intl';
import {
  IMAGE_ADJUST_RANGE,
  IMAGE_CROP_MAX_INSET,
  adjustImage,
  cropImage,
  flipImage,
  rotateImage,
  type ImageAdjustments,
  type ImageCrop,
  type ImageEdit,
} from '@/lib/creation/image/imageEdit';
import styles from './ImageEditor.module.css';

const ADJUSTMENTS: readonly (keyof ImageAdjustments)[] = ['brightness', 'contrast', 'saturation'];
const CROP_SIDES: readonly (keyof ImageCrop)[] = ['left', 'top', 'right', 'bottom'];

export interface ImageEditorControlsProps {
  edit: ImageEdit;
  onChange: (next: ImageEdit) => void;
}

/** Orientation, crop insets and the three tonal adjustments. Presentational: it only returns the next edit. */
export function ImageEditorControls({ edit, onChange }: ImageEditorControlsProps) {
  const t = useTranslations('canvas.kinds.image');
  const cropLabel: Record<keyof ImageCrop, string> = { left: t('cropSide.left'), top: t('cropSide.top'), right: t('cropSide.right'), bottom: t('cropSide.bottom') };
  const adjustLabel: Record<keyof ImageAdjustments, string> = { brightness: t('adjustment.brightness'), contrast: t('adjustment.contrast'), saturation: t('adjustment.saturation') };
  return <div className={styles.controls}>
    <div className={styles.row} role="group" aria-label={t('orientation')}>
      <button type="button" className={styles.toolButton} onClick={() => onChange(rotateImage(edit, -1))}>{t('rotateLeft')}</button>
      <button type="button" className={styles.toolButton} onClick={() => onChange(rotateImage(edit, 1))}>{t('rotateRight')}</button>
      <button type="button" className={styles.toolButton} aria-pressed={edit.flipX} onClick={() => onChange(flipImage(edit, 'x'))}>{t('flipHorizontal')}</button>
      <button type="button" className={styles.toolButton} aria-pressed={edit.flipY} onClick={() => onChange(flipImage(edit, 'y'))}>{t('flipVertical')}</button>
    </div>
    <fieldset className={styles.group}>
      <legend>{t('crop')}</legend>
      {CROP_SIDES.map((side) => <label key={side} className={styles.slider}>
        <span>{cropLabel[side]}</span>
        <input
          type="range" min="0" max={Math.round(IMAGE_CROP_MAX_INSET * 100)} value={Math.round(edit.crop[side] * 100)}
          onChange={(event) => onChange(cropImage(edit, { [side]: Number(event.target.value) / 100 }))}
        />
        <output>{Math.round(edit.crop[side] * 100)}%</output>
      </label>)}
    </fieldset>
    <fieldset className={styles.group}>
      <legend>{t('adjust')}</legend>
      {ADJUSTMENTS.map((channel) => <label key={channel} className={styles.slider}>
        <span>{adjustLabel[channel]}</span>
        <input
          type="range" min={IMAGE_ADJUST_RANGE.min} max={IMAGE_ADJUST_RANGE.max} value={edit.adjust[channel]}
          onChange={(event) => onChange(adjustImage(edit, { [channel]: Number(event.target.value) }))}
        />
        <output>{edit.adjust[channel]}%</output>
      </label>)}
    </fieldset>
  </div>;
}
