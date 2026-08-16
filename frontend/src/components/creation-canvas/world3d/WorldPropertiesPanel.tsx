import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  deleteProp,
  updateGround,
  updateLighting,
  updateProp,
  updateSkyColor,
  updateSpawn,
  type CanvasWorldPhysicsKind,
  type CanvasWorldProp,
  type CanvasWorldScene,
} from '@builderforce/creation-canvas-contract';
import styles from '../CreationCanvas.module.css';

/**
 * WorldPropertiesPanel — right-rail inspector for `world` surfaces.
 * Selection-aware: a selected prop shows its transform / appearance /
 * physics / delete; nothing selected shows the scene-level sky, ground,
 * spawn and lighting controls.
 *
 * Adapted from hired.video's `world-3d/Game3DPropertiesPanel.tsx`. Trimmed:
 * no texture/tag fields (dropped with challenges — see `world.ts`'s header),
 * no `InspectorSectionList` accordion dependency (this repo has no
 * equivalent primitive) — sections are always-open here instead, which is
 * plenty for the field count this panel actually has.
 */

const PHYSICS_KINDS: readonly CanvasWorldPhysicsKind[] = ['static', 'dynamic', 'kinematic', 'sensor', 'none'];

interface WorldPropertiesPanelProps {
  scene: CanvasWorldScene;
  onChange: (next: CanvasWorldScene) => void;
  selectedPropId: string | null;
  onSelectProp: (id: string | null) => void;
}

export default function WorldPropertiesPanel({ scene, onChange, selectedPropId, onSelectProp }: WorldPropertiesPanelProps) {
  const t = useTranslations('creationCanvas.surface.world');
  const prop = useMemo<CanvasWorldProp | null>(
    () => scene.props.find((candidate) => candidate.id === selectedPropId) ?? null,
    [scene.props, selectedPropId],
  );

  if (prop) {
    return (
      <div className={styles.worldProperties}>
        <PanelSection title={t('panel.transform')}>
          <Vec3Field label={t('panel.position')} value={prop.position} step={0.5} onChange={(position) => onChange(updateProp(scene, prop.id, { position }))} />
          <Vec3Field label={t('panel.rotation')} value={prop.rotation} step={Math.PI / 12} onChange={(rotation) => onChange(updateProp(scene, prop.id, { rotation }))} />
          <Vec3Field label={t('panel.scale')} value={prop.scale} step={0.25} min={0.1} onChange={(scale) => onChange(updateProp(scene, prop.id, { scale }))} />
        </PanelSection>
        <PanelSection title={t('panel.appearance')}>
          <label className={styles.worldFieldRow}>
            <span>{t('panel.color')}</span>
            <input type="color" value={prop.color} onChange={(event) => onChange(updateProp(scene, prop.id, { color: event.target.value }))} className={styles.worldColorInput} />
            <code>{prop.color}</code>
          </label>
        </PanelSection>
        <PanelSection title={t('panel.physics')}>
          <label className={styles.worldFieldRow}>
            <span>{t('panel.body')}</span>
            <select
              value={prop.physics}
              onChange={(event) => onChange(updateProp(scene, prop.id, { physics: event.target.value as CanvasWorldPhysicsKind }))}
              className={styles.worldSelect}
            >
              {PHYSICS_KINDS.map((kind) => <option key={kind} value={kind}>{t(`panel.physicsKind.${kind}`)}</option>)}
            </select>
          </label>
        </PanelSection>
        <PanelSection title={t('panel.actions')}>
          <button
            type="button"
            className={styles.worldDeleteAction}
            onClick={() => { onChange(deleteProp(scene, prop.id)); onSelectProp(null); }}
          >
            {t('panel.deleteProp')}
          </button>
        </PanelSection>
      </div>
    );
  }

  return (
    <div className={styles.worldProperties}>
      <PanelSection title={t('panel.sky')}>
        <label className={styles.worldFieldRow}>
          <span>{t('panel.skyColor')}</span>
          <input type="color" value={scene.skyColor} onChange={(event) => onChange(updateSkyColor(scene, event.target.value))} className={styles.worldColorInput} />
        </label>
        <label className={styles.worldFieldRow}>
          <span>{t('panel.groundColor')}</span>
          <input type="color" value={scene.ground.color} onChange={(event) => onChange(updateGround(scene, { color: event.target.value }))} className={styles.worldColorInput} />
        </label>
        <label className={styles.worldFieldRow}>
          <span>{t('panel.groundSize')}</span>
          <input
            type="number"
            value={scene.ground.size}
            min={10}
            max={500}
            step={10}
            onChange={(event) => { const n = Number.parseFloat(event.target.value); if (Number.isFinite(n)) onChange(updateGround(scene, { size: n })); }}
            className={styles.worldNumberInput}
          />
        </label>
      </PanelSection>
      <PanelSection title={t('panel.spawn')}>
        <Vec3Field label="" value={scene.spawn.position} step={0.5} onChange={(position) => onChange(updateSpawn(scene, { position }))} />
      </PanelSection>
      <PanelSection title={t('panel.lighting')}>
        <label className={styles.worldFieldRow}>
          <span>{t('panel.ambient')}</span>
          <input
            type="range" min={0} max={2} step={0.05} value={scene.lighting.ambient.intensity}
            onChange={(event) => onChange(updateLighting(scene, { ambient: { ...scene.lighting.ambient, intensity: Number(event.target.value) } }))}
          />
          <code>{scene.lighting.ambient.intensity.toFixed(2)}</code>
        </label>
        <label className={styles.worldFieldRow}>
          <span>{t('panel.sun')}</span>
          <input
            type="range" min={0} max={3} step={0.05} value={scene.lighting.sun.intensity}
            onChange={(event) => onChange(updateLighting(scene, { sun: { ...scene.lighting.sun, intensity: Number(event.target.value) } }))}
          />
          <code>{scene.lighting.sun.intensity.toFixed(2)}</code>
        </label>
      </PanelSection>
      <PanelSection title={t('panel.stats')}>
        <div className={styles.worldFieldRow}><span>{t('panel.propCount')}</span><code>{scene.props.length}</code></div>
      </PanelSection>
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.worldPropertiesSection}>
      <h4>{title}</h4>
      {children}
    </section>
  );
}

interface Vec3FieldProps {
  label: string;
  value: [number, number, number];
  step?: number;
  min?: number;
  onChange: (next: [number, number, number]) => void;
}

function Vec3Field({ label, value, step = 0.5, min, onChange }: Vec3FieldProps) {
  const update = (index: number, raw: string) => {
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return;
    const next: [number, number, number] = [...value];
    next[index] = n;
    onChange(next);
  };
  return (
    <div className={styles.worldVec3}>
      {label && <div className={styles.worldVec3Label}>{label}</div>}
      <div className={styles.worldVec3Row}>
        {(['x', 'y', 'z'] as const).map((axis, index) => (
          <label key={axis} className={styles.worldVec3Axis}>
            <span>{axis}</span>
            <input type="number" value={Number(value[index]!.toFixed(3))} step={step} min={min} onChange={(event) => update(index, event.target.value)} />
          </label>
        ))}
      </div>
    </div>
  );
}
