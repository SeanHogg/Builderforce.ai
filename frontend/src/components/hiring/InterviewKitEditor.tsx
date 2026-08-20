/**
 * The interview kit editor — the template a loop is run from.
 *
 * ── A KIT IS EDITED AS A DOCUMENT ────────────────────────────────────────────────
 * The whole stage list is posted on save, because the server replaces it wholesale: the
 * position index is unique per kit, so a partial reorder would collide with itself
 * mid-renumber. That is not a UI concession — it is the shape somebody actually edits an
 * interview process in.
 *
 * ── THE DEFAULT IS SEEDED, NOT DEMANDED ──────────────────────────────────────────
 * A tenant with no kits gets the house loop on first open rather than an empty page
 * asking them to design an interview process before they can schedule a call. The seeding
 * is the server's (`ensureDefaultKit`); this just asks for it.
 *
 * Deleting a kit is the one DESTRUCTIVE action here, so it goes through `useConfirm` —
 * the app's one confirmation, never `window.confirm`.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { useConfirm } from '@/components/ConfirmProvider';
import type { AtsKit, AtsKitStageInput, AtsVocabulary } from '@/lib/hiringApi';
import { buttonStyle, cardStyle, chipStyle, inputStyle, labelStyle, mutedStyle, primaryButtonStyle } from './hiringStyles';

export interface InterviewKitEditorProps {
  kits: AtsKit[];
  vocabulary: AtsVocabulary | null;
  saving: boolean;
  error: string | null;
  onSeedDefault: () => Promise<void>;
  onSaveStages: (kitId: number, stages: AtsKitStageInput[]) => Promise<void>;
  onMakeDefault: (kitId: number) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onDelete: (kitId: number) => Promise<void>;
}

/** A kit's stages as the editor holds them — the wire shape, so saving is a pass-through
 *  rather than a translation that can drift. */
function toStageInputs(kit: AtsKit): AtsKitStageInput[] {
  return kit.stages.map((stage) => ({
    name: stage.name,
    kind: stage.kind,
    durationMin: stage.durationMin,
    interviewerRefs: stage.interviewerRefs,
    guidance: stage.guidance,
    scorecardId: stage.scorecardId,
    scorecard: stage.scorecard.map((attribute) => ({
      key: attribute.key,
      label: attribute.label,
      weight: attribute.weight,
      scaleMin: attribute.scaleMin,
      scaleMax: attribute.scaleMax,
    })),
  }));
}

export function InterviewKitEditor(props: InterviewKitEditorProps) {
  const t = useTranslations('ats');
  const confirm = useConfirm();
  const [newName, setNewName] = useState('');

  if (props.kits.length === 0) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', padding: 32 }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t('kits.emptyTitle')}</p>
        <p style={{ ...mutedStyle, marginTop: 6 }}>{t('kits.emptyBody')}</p>
        <RoleGate capability="hiring.manage" style={{ marginTop: 12 }}>
          <button type="button" disabled={props.saving} style={primaryButtonStyle} onClick={() => { void props.onSeedDefault(); }}>
            {t('kits.seedDefault')}
          </button>
        </RoleGate>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {props.error && <p style={{ ...mutedStyle, color: 'var(--danger-text)' }}>{props.error}</p>}

      <RoleGate capability="hiring.manage" variant="block">
        <div style={{ ...cardStyle, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <label style={labelStyle} htmlFor="ats-kit-name">{t('kits.newName')}</label>
            <input id="ats-kit-name" value={newName} onChange={(event) => setNewName(event.target.value)} style={inputStyle} />
          </div>
          <button
            type="button"
            disabled={props.saving || !newName.trim()}
            style={{ ...primaryButtonStyle, opacity: props.saving || !newName.trim() ? 0.6 : 1 }}
            onClick={() => { void props.onCreate(newName.trim()).then(() => setNewName('')); }}
          >
            {t('kits.create')}
          </button>
        </div>
      </RoleGate>

      {props.kits.map((kit) => (
        <KitCard
          key={kit.id}
          kit={kit}
          vocabulary={props.vocabulary}
          saving={props.saving}
          onSaveStages={props.onSaveStages}
          onMakeDefault={props.onMakeDefault}
          onDelete={async () => {
            const confirmed = await confirm({
              title: t('kits.deleteTitle'),
              message: t('kits.deleteConfirm', { name: kit.name }),
              destructive: true,
            });
            if (confirmed) await props.onDelete(kit.id);
          }}
        />
      ))}
    </div>
  );
}

function KitCard({
  kit, vocabulary, saving, onSaveStages, onMakeDefault, onDelete,
}: {
  kit: AtsKit;
  vocabulary: AtsVocabulary | null;
  saving: boolean;
  onSaveStages: (kitId: number, stages: AtsKitStageInput[]) => Promise<void>;
  onMakeDefault: (kitId: number) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = useTranslations('ats');
  const [stages, setStages] = useState<AtsKitStageInput[]>(() => toStageInputs(kit));
  const kinds = vocabulary?.kitStageKinds ?? [];

  const patchStage = (index: number, patch: Partial<AtsKitStageInput>) =>
    setStages((current) => current.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)));

  return (
    <section style={cardStyle}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{kit.name}</h3>
        {kit.isDefault && <span style={chipStyle}>{t('kits.default')}</span>}
        {kit.roleFamily && <span style={chipStyle}>{kit.roleFamily}</span>}
      </header>
      {kit.description && <p style={{ ...mutedStyle, marginTop: 6 }}>{kit.description}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        {stages.map((stage, index) => (
          <div key={`${kit.id}-${index}`} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
              <div>
                <label style={labelStyle} htmlFor={`kit-${kit.id}-name-${index}`}>{t('kits.stageName')}</label>
                <input
                  id={`kit-${kit.id}-name-${index}`}
                  value={stage.name}
                  onChange={(event) => patchStage(index, { name: event.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle} htmlFor={`kit-${kit.id}-kind-${index}`}>{t('kits.stageKind')}</label>
                <Select
                  id={`kit-${kit.id}-kind-${index}`}
                  value={stage.kind ?? 'screen'}
                  onChange={(event) => patchStage(index, { kind: event.target.value })}
                  style={inputStyle}
                >
                  {kinds.map((kind) => (
                    <option key={kind} value={kind}>{t(`kits.kind.${kind}` as never)}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label style={labelStyle} htmlFor={`kit-${kit.id}-duration-${index}`}>{t('kits.duration')}</label>
                <input
                  id={`kit-${kit.id}-duration-${index}`}
                  inputMode="numeric"
                  value={stage.durationMin ?? ''}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    patchStage(index, { durationMin: event.target.value.trim() && Number.isFinite(value) ? value : null });
                  }}
                  style={inputStyle}
                />
              </div>
            </div>
            {/* The scorecard's DIMENSIONS. Reports aggregate across scorecards by
                attribute, which is why they are rows rather than a note in the guidance. */}
            {(stage.scorecard ?? []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {(stage.scorecard ?? []).map((attribute) => (
                  <span key={attribute.key} style={chipStyle}>
                    {attribute.label} · ×{attribute.weight ?? 1}
                  </span>
                ))}
              </div>
            )}
            <RoleGate capability="hiring.manage" style={{ marginTop: 8 }}>
              <button
                type="button"
                style={buttonStyle}
                disabled={saving}
                onClick={() => setStages((current) => current.filter((_, i) => i !== index))}
              >
                {t('kits.removeStage')}
              </button>
            </RoleGate>
          </div>
        ))}
      </div>

      <RoleGate capability="hiring.manage" variant="block" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            style={buttonStyle}
            disabled={saving}
            onClick={() => setStages((current) => [...current, { name: '', kind: 'screen', durationMin: 45, scorecard: [] }])}
          >
            {t('kits.addStage')}
          </button>
          <button
            type="button"
            style={primaryButtonStyle}
            disabled={saving}
            onClick={() => { void onSaveStages(kit.id, stages.filter((stage) => stage.name.trim())); }}
          >
            {t('kits.save')}
          </button>
          {!kit.isDefault && (
            <button type="button" style={buttonStyle} disabled={saving} onClick={() => { void onMakeDefault(kit.id); }}>
              {t('kits.makeDefault')}
            </button>
          )}
          <button
            type="button"
            style={{ ...buttonStyle, color: 'var(--danger-text)', borderColor: 'var(--danger-border)' }}
            disabled={saving}
            onClick={() => { void onDelete(); }}
          >
            {t('kits.delete')}
          </button>
        </div>
      </RoleGate>
    </section>
  );
}
