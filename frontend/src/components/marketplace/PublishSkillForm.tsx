/**
 * Publish a skill to the marketplace — optionally FROM an Agent Skills folder.
 *
 * Pick a SKILL.md folder and the listing fills itself from it: the slug is the skill's
 * spec `name`, the description its `description`, and the folder — instructions,
 * scripts, references — is what an installer downloads. Without a folder it still
 * publishes a listing from the form, as before.
 *
 * Extracted from `MarketplacePageClient` (which had grown past a thousand lines) so the
 * page renders it and owns nothing about publishing. It owns its own form state, its
 * own call and its own outcome.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toSkillName } from '@builderforce/agent-skills';
import { Select } from '@/components/Select';
import { SkillFolderPicker, SkillIssueList, type PickedSkill } from '@/components/skills/SkillFolderPicker';
import { faultMessage } from '@/lib/apiClient';
import { marketplacePublisherApi } from '@/lib/marketplaceSkillsApi';
import { invalidateMarketplaceSkills } from '@/lib/marketplace/marketplaceReads';
import { useIsMobile } from '@/lib/useIsMobile';
import { SkillFolderRejected, skillIssuesError } from '@/lib/workspaceSkillsApi';
import type { SkillIssue } from '@builderforce/agent-skills';

type PricingModel = 'flat_fee' | 'consumption';

const EMPTY = { name: '', slug: '', description: '', category: '', version: '1.0.0', repoUrl: '', price: '0', pricingModel: 'flat_fee' as PricingModel, priceUnit: '' };

const label: React.CSSProperties = { display: 'block', fontSize: 'var(--font-size-small)', color: 'var(--muted)', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 'var(--font-size-small)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text)', boxSizing: 'border-box' };

export function PublishSkillForm() {
  const tm = useTranslations('marketplace');
  const tf = useTranslations('skillFolder');
  const isMobile = useIsMobile();
  const [form, setForm] = useState(EMPTY);
  const [folder, setFolder] = useState<PickedSkill | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<SkillIssue[]>([]);
  const [success, setSuccess] = useState(false);

  /** A picked folder decides slug + description; the form keeps the rest editable. */
  const pickFolder = (picked: PickedSkill | null) => {
    setFolder(picked);
    setRefusal([]);
    if (!picked) return;
    const m = picked.pkg.manifest;
    setForm((f) => ({
      ...f,
      name: f.name || m.metadata?.title || m.name,
      slug: m.name,
      description: m.description,
      version: m.metadata?.version ?? f.version,
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.slug.trim()) return;
    setPublishing(true);
    setError(null);
    setRefusal([]);
    setSuccess(false);
    try {
      invalidateMarketplaceSkills();
      await marketplacePublisherApi.publishSkill({
        name: form.name.trim(),
        slug: toSkillName(form.slug),
        description: form.description.trim() || undefined,
        category: form.category.trim() || undefined,
        version: form.version.trim() || '1.0.0',
        repoUrl: form.repoUrl.trim() || undefined,
        price: Number(form.price) || 0,
        pricingModel: form.pricingModel,
        ...(form.pricingModel === 'consumption' && form.priceUnit.trim() ? { priceUnit: form.priceUnit.trim() } : {}),
        ...(folder ? { files: folder.files } : {}),
      });
      setSuccess(true);
      setForm(EMPTY);
      setFolder(null);
    } catch (err) {
      const typed = skillIssuesError(err);
      if (typed instanceof SkillFolderRejected) setRefusal(typed.issues);
      else setError(faultMessage(err, tm('publish.failed')));
    } finally {
      setPublishing(false);
    }
  };

  const fromFolder = folder != null;

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: isMobile ? 16 : 24 }}>
      <div style={{ fontWeight: 700, fontSize: 'var(--font-size-card-title)', marginBottom: 16 }}>{tm('publish.heading')}</div>
      {success && (
        <div style={{ marginBottom: 12, padding: '10px 14px', fontSize: 'var(--font-size-small)', color: 'var(--success)', background: 'color-mix(in srgb, var(--success) 8%, transparent)', borderRadius: 'var(--radius-md)', border: '1px solid color-mix(in srgb, var(--success) 25%, transparent)' }}>
          {tm('publish.success')}
        </div>
      )}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 650, fontSize: 'var(--font-size-small)', marginBottom: 4 }}>{tf('publishFromFolder')}</div>
        <p style={{ margin: '0 0 8px', fontSize: 'var(--font-size-small)', color: 'var(--muted)' }}>{tf('publishFromFolderHint')}</p>
        <SkillFolderPicker onChange={pickFolder} />
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
          <div>
            <label style={label}>{tm('publish.name')} *</label>
            <input required type="text" placeholder={tm('publish.namePlaceholder')} value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: fromFolder || f.slug ? f.slug : toSkillName(e.target.value) }))}
              style={input} />
          </div>
          <div>
            <label style={label}>{tm('publish.slug')} * {fromFolder ? `(${tf('derivedFromFolder')})` : tm('publish.slugHint')}</label>
            <input required type="text" placeholder={tm('publish.slugPlaceholder')} value={form.slug} readOnly={fromFolder}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
              style={{ ...input, fontFamily: 'var(--font-mono)', opacity: fromFolder ? 0.75 : 1 }} />
          </div>
        </div>
        <div>
          <label style={label}>{tm('publish.description')}{fromFolder ? ` (${tf('derivedFromFolder')})` : ''}</label>
          <textarea rows={3} placeholder={tm('publish.descriptionPlaceholder')} value={form.description} readOnly={fromFolder}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            style={{ ...input, resize: 'vertical', opacity: fromFolder ? 0.75 : 1 }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10 }}>
          <div>
            <label style={label}>{tm('publish.category')}</label>
            <input type="text" placeholder={tm('publish.categoryPlaceholder')} value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} style={input} />
          </div>
          <div>
            <label style={label}>{tm('publish.version')}</label>
            <input type="text" value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))} style={input} />
          </div>
          <div>
            <label style={label}>{tm('publish.repoUrl')}</label>
            <input type="url" placeholder={tm('publish.repoPlaceholder')} value={form.repoUrl}
              onChange={(e) => setForm((f) => ({ ...f, repoUrl: e.target.value }))} style={input} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10 }}>
          <div>
            <label style={label}>{tm('publish.price')}</label>
            <input type="number" min="0" step="0.01" placeholder={tm('publish.pricePlaceholder')} value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} style={input} />
          </div>
          <div>
            <label style={label}>{tm('publish.pricingModel')}</label>
            <Select value={form.pricingModel} onChange={(e) => setForm((f) => ({ ...f, pricingModel: e.target.value as PricingModel }))} style={input}>
              <option value="flat_fee">{tm('publish.flatFee')}</option>
              <option value="consumption">{tm('publish.consumption')}</option>
            </Select>
          </div>
          {form.pricingModel === 'consumption' && (
            <div>
              <label style={label}>{tm('publish.priceUnit')}</label>
              <input type="text" placeholder={tm('publish.priceUnitPlaceholder')} value={form.priceUnit}
                onChange={(e) => setForm((f) => ({ ...f, priceUnit: e.target.value }))} style={input} />
            </div>
          )}
        </div>
        <SkillIssueList issues={refusal} />
        {error && <div role="alert" style={{ fontSize: 'var(--font-size-small)', color: 'var(--error-text)' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={publishing || !form.name.trim() || !form.slug.trim()} className="btn btn-primary">
            {publishing ? tm('publish.submitting') : tm('publish.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
