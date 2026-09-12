'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import type { ConnectableProvider, CredentialFieldDescriptor } from '@/lib/connectableCatalog';
import { draftProblem, isRotating, type CredentialDraft } from './credentialDraft';
import { btnPrimary, btnSubtle, formPanel, inputStyle } from './integrationStyles';

/**
 * The add / edit form for one integration key, rendered ENTIRELY from the
 * server's connect-catalog descriptor: which fields, which are secret, which are
 * required, whether a base URL is needed. No provider is named in this file.
 *
 * Field labels are translated by field KEY (`integrationCredentials.fields.<key>`)
 * — the server declares one label per key (credentialFields.ts), so a key means
 * the same thing on every provider and one message serves them all. Provider
 * names are brand names and render literally; placeholders are format examples.
 */

export interface CredentialKeyEdit {
  id: string;
  provider: string;
  name: string;
  baseUrl: string | null;
}

export interface CredentialKeyFormProps {
  /** Picker options — non-empty. On edit, just the key's own provider. */
  providers: ConnectableProvider[];
  /** Set to edit (rotate / rename / re-point) an existing key. */
  editing: CredentialKeyEdit | null;
  saving: boolean;
  /** A save failure reported by the caller. */
  serverError: string | null;
  onSave: (draft: CredentialDraft, rotating: boolean) => void;
  onCancel: () => void;
}

export function CredentialKeyForm({ providers, editing, saving, serverError, onSave, onCancel }: CredentialKeyFormProps) {
  const t = useTranslations('integrationCredentials');
  const tc = useTranslations('common');
  // Secrets are never returned in the clear, so they always start blank: on edit,
  // blank = keep the current key, any value = rotate it.
  const [draft, setDraft] = useState<CredentialDraft>(() => ({
    provider: editing?.provider ?? providers[0]?.id ?? '',
    name: editing?.name ?? '',
    baseUrl: editing?.baseUrl ?? '',
    secrets: {},
  }));
  const [problem, setProblem] = useState<string | null>(null);

  const descriptor = providers.find((p) => p.id === draft.provider) ?? providers[0];
  if (!descriptor) return null;

  const fieldLabel = (field: CredentialFieldDescriptor) => {
    const base = t.has(`fields.${field.key}`) ? t(`fields.${field.key}`) : field.label;
    return field.required ? base : t('optionalField', { field: base });
  };

  const submit = () => {
    const found = draftProblem(descriptor, draft, editing != null);
    if (!found) {
      setProblem(null);
      onSave(draft, isRotating(descriptor, draft));
      return;
    }
    if (found.kind === 'baseUrlRequired') {
      setProblem(t('baseUrlRequired'));
      return;
    }
    const field = descriptor.credentialFields.find((f) => f.key === found.fieldKey);
    const label = field ? fieldLabel(field) : found.fieldKey;
    setProblem(found.kind === 'rotateFieldMissing' ? t('rotateFieldMissing', { field: label }) : t('fieldRequired', { field: label }));
  };

  const baseUrlLabel = descriptor.baseUrl === 'required' ? t('baseUrlRequiredPlaceholder') : t('baseUrlOptionalPlaceholder');
  const shownError = problem ?? serverError;

  return (
    <div style={formPanel}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        {editing ? t('editKeyTitle', { provider: descriptor.label }) : t('addKeyTitle')}
      </div>
      <Select
        aria-label={t('providerSelect')}
        value={descriptor.id}
        onChange={(e) => { setDraft((d) => ({ ...d, provider: e.target.value, secrets: {} })); setProblem(null); }}
        style={inputStyle}
        // Provider is fixed once a key exists — rotating/renaming only.
        disabled={editing != null}
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </Select>
      {descriptor.transport === 'tcp' && (
        <div role="note" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {t('tcpTransportNote', { provider: descriptor.label })}
        </div>
      )}
      <input
        style={inputStyle}
        aria-label={t('labelPlaceholder')}
        placeholder={t('labelPlaceholder')}
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
      />
      {descriptor.baseUrl !== 'none' && (
        <input
          style={inputStyle}
          type="url"
          aria-label={baseUrlLabel}
          placeholder={baseUrlLabel}
          value={draft.baseUrl}
          onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
        />
      )}
      {descriptor.credentialFields.map((field) => {
        const label = fieldLabel(field);
        return (
          <input
            key={field.key}
            style={inputStyle}
            type={field.secret ? 'password' : 'text'}
            autoComplete={field.secret ? 'new-password' : 'off'}
            aria-label={label}
            placeholder={editing ? t('secretEditPlaceholder', { field: label }) : (field.placeholder ?? label)}
            value={draft.secrets[field.key] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, secrets: { ...d.secrets, [field.key]: e.target.value } }))}
          />
        );
      })}
      {editing && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {descriptor.credentialFields.length > 1 ? t('rotateHintMulti') : t('rotateHintSingle')}
        </div>
      )}
      {shownError && <div role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>{shownError}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={btnPrimary} disabled={saving} onClick={submit}>
          {saving ? tc('saving') : editing ? t('saveChanges') : t('saveKey')}
        </button>
        <button type="button" style={btnSubtle} onClick={onCancel}>
          {tc('cancel')}
        </button>
      </div>
    </div>
  );
}
