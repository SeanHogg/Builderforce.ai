'use client';

/**
 * MY LLMs — the editor for a tenant's named model configs (`tenant_models`,
 * migration 0211).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * These rows have fed every model picker in the product since 0211 (a
 * `tenant_model:<slug>` ref selectable from chat, an agent's base model, a cloud
 * run) — but nothing in the app could CREATE or EDIT one. The only way a row
 * appeared was as a side effect of publishing an Evermind from LLM Studio, so the
 * three columns that make a named model useful (`system_prompt`, `params`,
 * `persona_id`) were server-supported and unreachable. A picker whose entries
 * nobody can author is a feature with no front door.
 *
 * ── THE SETTLED QUESTION ───────────────────────────────────────────────────
 * The register asked whether to retire "presets" or rename the group. Neither:
 * `tenant_models` IS the source, and it always was — LLM Studio publishes into this
 * same table, so a published Evermind and a hand-authored config are the same kind
 * of thing and belong in one list. This page is that list. Published Evermind rows
 * are shown with their origin marked and their base model locked, because their base
 * is an `evermind/<ref>` pin that only the publish flow can mint; everything else
 * about them (prompt, sampling, persona) is editable here like any other row.
 *
 * ── PERSONA ────────────────────────────────────────────────────────────────
 * `persona_id` was the specific gap named: the column and the runtime were both
 * live, so a model could carry a persona and no surface could set one. The picker
 * lists the tenant's OWN personas (`/api/personas/mine`), which is the same set the
 * agent assignment surfaces use.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import PageContainer from '@/components/PageContainer';
import { ModelSelect } from '@/components/llm/ModelSelect';
import {
  tenantModelApi,
  personasApi,
  type TenantModel,
  type TenantModelInput,
  type PublicPersona,
} from '@/lib/builderforceApi';

/** A published Evermind pins `evermind/<ref>`; only the publish flow can mint one. */
const EVERMIND_PIN_PREFIX = 'evermind/';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  fontSize: 'var(--font-size-small)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
};

// A native <select>'s popup is painted by the OS, which does NOT inherit the page
// background — the options need their own opaque colours or they render as
// dark-on-dark in one theme.
const optionStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
};

const buttonPrimary: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  background: 'var(--surface-interactive)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

const buttonGhost: React.CSSProperties = {
  ...buttonPrimary,
  background: 'none',
};

const buttonDanger: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 'var(--font-size-eyebrow)',
  fontWeight: 600,
  background: 'none',
  color: 'var(--coral-bright)',
  border: '1px solid var(--coral-bright)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};

interface DraftState {
  name: string;
  baseModel: string;
  systemPrompt: string;
  temperature: string;
  topP: string;
  personaId: string;
  visibility: 'private' | 'tenant';
}

const EMPTY_DRAFT: DraftState = {
  name: '',
  baseModel: '',
  systemPrompt: '',
  temperature: '',
  topP: '',
  personaId: '',
  visibility: 'private',
};

function draftFrom(model: TenantModel): DraftState {
  const params = model.params ?? {};
  return {
    name: model.name,
    baseModel: model.baseModel ?? '',
    systemPrompt: model.systemPrompt ?? '',
    temperature: typeof params.temperature === 'number' ? String(params.temperature) : '',
    topP: typeof params.top_p === 'number' ? String(params.top_p) : '',
    personaId: model.personaId ?? '',
    visibility: model.visibility,
  };
}

/** Parse a sampling field. Blank → omitted (inherit); out-of-range → omitted too,
 *  because storing a number the gateway would ignore is worse than storing none. */
function samplingValue(raw: string, max: number): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
}

function draftToInput(draft: DraftState): TenantModelInput {
  const temperature = samplingValue(draft.temperature, 2);
  const topP = samplingValue(draft.topP, 1);
  const params: Record<string, unknown> = {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
  };
  return {
    name: draft.name.trim(),
    baseModel: draft.baseModel.trim() || null,
    systemPrompt: draft.systemPrompt.trim() || null,
    params: Object.keys(params).length > 0 ? params : null,
    personaId: draft.personaId || null,
    visibility: draft.visibility,
  };
}

export function MyLlmsContent() {
  const t = useTranslations('myLlms');
  const confirm = useConfirm();

  const [models, setModels] = useState<TenantModel[]>([]);
  const [personas, setPersonas] = useState<PublicPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** `null` = nothing open, `''` = the create form, otherwise the id being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Personas are advisory: the editor is still usable when that list fails, so a
      // persona-service hiccup must not take the whole page down with it.
      const [list, personaList] = await Promise.all([
        tenantModelApi.list(),
        personasApi.listMine().catch(() => [] as PublicPersona[]),
      ]);
      setModels(list.models ?? []);
      setPersonas(personaList);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const personaName = useMemo(() => {
    const byId = new Map(personas.map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? byId.get(id) ?? id : null);
  }, [personas]);

  const openCreate = () => { setDraft(EMPTY_DRAFT); setEditing(''); };
  const openEdit = (model: TenantModel) => { setDraft(draftFrom(model)); setEditing(model.id); };
  const close = () => { setEditing(null); setDraft(EMPTY_DRAFT); };

  const save = async () => {
    if (!draft.name.trim()) { setError(t('errors.nameRequired')); return; }
    setSaving(true);
    setError(null);
    try {
      const input = draftToInput(draft);
      if (editing) await tenantModelApi.update(editing, input);
      else await tenantModelApi.create(input);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.save'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (model: TenantModel) => {
    // Destructive and unrecoverable — every picker that referenced this ref loses it,
    // so this is the modal case rather than an inline action.
    const ok = await confirm({
      title: t('delete.title'),
      message: t('delete.message', { name: model.name }),
      confirmLabel: t('delete.confirm'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await tenantModelApi.remove(model.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.delete'));
    }
  };

  const editingModel = editing ? models.find((m) => m.id === editing) ?? null : null;
  const basePinnedByPublish = !!editingModel?.baseModel?.startsWith(EVERMIND_PIN_PREFIX);

  return (
    <PageContainer>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{t('title')}</h1>
            <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', margin: '6px 0 0', maxWidth: '60ch' }}>{t('subtitle')}</p>
          </div>
          {editing === null && (
            <button type="button" style={buttonPrimary} onClick={openCreate}>{t('actions.create')}</button>
          )}
        </div>

        {error && (
          <div role="alert" style={{ ...cardStyle, borderColor: 'var(--coral-bright)', color: 'var(--coral-bright)', fontSize: 'var(--font-size-small)' }}>
            {error}
          </div>
        )}

        {editing !== null && (
          <div style={cardStyle}>
            <h2 style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 14px' }}>
              {editing ? t('form.editTitle') : t('form.createTitle')}
            </h2>
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
              <div>
                <label style={labelStyle} htmlFor="llm-name">{t('form.name')}</label>
                <input
                  id="llm-name"
                  style={inputStyle}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder={t('form.namePlaceholder')}
                />
              </div>

              <div>
                <label style={labelStyle} htmlFor="llm-base">{t('form.baseModel')}</label>
                {basePinnedByPublish ? (
                  <p style={{ ...inputStyle, margin: 0, color: 'var(--text-secondary)' }}>
                    {t('form.baseModelPinned', { model: draft.baseModel })}
                  </p>
                ) : (
                  <ModelSelect
                    value={draft.baseModel}
                    onChange={(next) => setDraft({ ...draft, baseModel: next })}
                    // A blank base is legitimate: the model then runs on the plan
                    // default, which is what `baseModel: null` means server-side.
                    defaultLabel={t('form.baseModelDefault')}
                    preserveValue={draft.baseModel}
                    style={inputStyle}
                  />
                )}
                <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '6px 0 0' }}>{t('form.baseModelHint')}</p>
              </div>

              <div>
                <label style={labelStyle} htmlFor="llm-persona">{t('form.persona')}</label>
                <select
                  id="llm-persona"
                  style={inputStyle}
                  value={draft.personaId}
                  onChange={(e) => setDraft({ ...draft, personaId: e.target.value })}
                >
                  <option value="" style={optionStyle}>{t('form.personaNone')}</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id} style={optionStyle}>{p.name}</option>
                  ))}
                </select>
                <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                  {personas.length === 0 ? t('form.personaEmpty') : t('form.personaHint')}
                </p>
              </div>

              <div>
                <label style={labelStyle} htmlFor="llm-visibility">{t('form.visibility')}</label>
                <select
                  id="llm-visibility"
                  style={inputStyle}
                  value={draft.visibility}
                  onChange={(e) => setDraft({ ...draft, visibility: e.target.value as 'private' | 'tenant' })}
                >
                  <option value="private" style={optionStyle}>{t('form.visibilityPrivate')}</option>
                  <option value="tenant" style={optionStyle}>{t('form.visibilityTenant')}</option>
                </select>
              </div>

              <div>
                <label style={labelStyle} htmlFor="llm-temp">{t('form.temperature')}</label>
                <input
                  id="llm-temp"
                  style={inputStyle}
                  inputMode="decimal"
                  value={draft.temperature}
                  onChange={(e) => setDraft({ ...draft, temperature: e.target.value })}
                  placeholder={t('form.inherit')}
                />
              </div>

              <div>
                <label style={labelStyle} htmlFor="llm-topp">{t('form.topP')}</label>
                <input
                  id="llm-topp"
                  style={inputStyle}
                  inputMode="decimal"
                  value={draft.topP}
                  onChange={(e) => setDraft({ ...draft, topP: e.target.value })}
                  placeholder={t('form.inherit')}
                />
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={labelStyle} htmlFor="llm-prompt">{t('form.systemPrompt')}</label>
              <textarea
                id="llm-prompt"
                style={{ ...inputStyle, minHeight: 110, resize: 'vertical', fontFamily: 'inherit' }}
                value={draft.systemPrompt}
                onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                placeholder={t('form.systemPromptPlaceholder')}
              />
              <p style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', margin: '6px 0 0' }}>{t('form.systemPromptHint')}</p>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" style={buttonPrimary} onClick={() => void save()} disabled={saving}>
                {saving ? t('actions.saving') : t('actions.save')}
              </button>
              <button type="button" style={buttonGhost} onClick={close} disabled={saving}>{t('actions.cancel')}</button>
            </div>
          </div>
        )}

        <div style={cardStyle}>
          {loading ? (
            <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', margin: 0 }}>{t('loading')}</p>
          ) : models.length === 0 ? (
            <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', margin: 0 }}>{t('empty')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {models.map((model) => (
                <li
                  key={model.id}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 12,
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    paddingBottom: 12,
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                    <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {model.name}
                      {model.baseModel?.startsWith(EVERMIND_PIN_PREFIX) && (
                        <span style={{ marginLeft: 8, fontSize: 'var(--font-size-eyebrow)', fontWeight: 500, color: 'var(--text-muted)' }}>
                          {t('list.fromStudio')}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-word' }}>
                      <code>{model.ref}</code>
                      {' · '}
                      {model.baseModel ?? t('list.planDefault')}
                      {model.personaId && ` · ${t('list.persona', { name: personaName(model.personaId) ?? '' })}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" style={buttonGhost} onClick={() => openEdit(model)}>{t('actions.edit')}</button>
                    <button type="button" style={buttonDanger} onClick={() => void remove(model)}>{t('actions.delete')}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
