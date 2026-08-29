/**
 * Companies — the list, the create form, and what one company OWNS (IN-1, IN-3).
 *
 * The generic entity browser already renders `companies` as a table. This is the
 * other half: the projects building this company, the rooms it holds, the round
 * it is raising and the diligence still open — the state of the raise rather than
 * the columns of a row.
 *
 * ── ATTACHING A PROJECT IS AN ACT ───────────────────────────────────────────
 * `projects.company_id` (migration 1120) is nullable and was never backfilled,
 * because the only signal available to match old projects to companies is the
 * NAME and that is the string-matching defect FO-A1/FO-A2 exist to remove. So the
 * picker below offers UNASSIGNED projects and somebody chooses; nothing here
 * guesses, and a company with no projects reads as none rather than as a match
 * that looks like a fact.
 *
 * No `'use client'`: the boundary is `InvestorClient.tsx`, and repeating the
 * directive on every leaf adds files to a ratchet without adding meaning.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { Icon } from '@/components/ui/Icon';
import {
  investorApi,
  type CompanyDetail,
  type CompanyProject,
  type CompanySummary,
} from '@/lib/investorApi';
import { ConsolidateProjectsPanel } from './ConsolidateProjectsPanel';
import {
  buttonStyle, cardStyle, emptyStyle, errorStyle, gapChipStyle, inputStyle, labelStyle,
  listRowStyle, listStyle, message, mutedStyle, primaryButtonStyle, rowStyle, sectionStyle,
} from './investorStyles';

export function CompaniesView({
  companies,
  selectedId,
  onSelect,
  onCreated,
  detail,
  detailLoading,
  onDetailChanged,
}: {
  companies: CompanySummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreated: (company: CompanySummary) => void;
  detail: CompanyDetail | null;
  detailLoading: boolean;
  onDetailChanged: () => void;
}) {
  const t = useTranslations('investor');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [stage, setStage] = useState('');
  const [sector, setSector] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(() => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    investorApi.companies
      .create({
        name: name.trim(),
        website: website.trim() || null,
        stage: stage.trim() || null,
        sector: sector.trim() || null,
      })
      .then((company) => {
        onCreated(company);
        setCreating(false);
        setName('');
        setWebsite('');
        setStage('');
        setSector('');
      })
      .catch((cause: unknown) => setError(message(cause, t('error.createCompany'))))
      .finally(() => setBusy(false));
  }, [name, onCreated, sector, stage, t, website]);

  return (
    <div style={sectionStyle}>
      <div style={rowStyle}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('companies.title')}</h2>
        <button type="button" style={primaryButtonStyle} onClick={() => setCreating((open) => !open)}>
          {creating ? t('common.cancel') : t('companies.add')}
        </button>
      </div>
      <p style={mutedStyle}>{t('companies.blurb')}</p>

      {error && <p style={errorStyle} role="alert">{error}</p>}

      {creating && (
        <div style={cardStyle}>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div>
              <label style={labelStyle} htmlFor="company-name">{t('companies.name')}</label>
              <input id="company-name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="company-website">{t('companies.website')}</label>
              <input id="company-website" style={inputStyle} value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="company-stage">{t('companies.stage')}</label>
              <input id="company-stage" style={inputStyle} value={stage} onChange={(e) => setStage(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="company-sector">{t('companies.sector')}</label>
              <input id="company-sector" style={inputStyle} value={sector} onChange={(e) => setSector(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" style={primaryButtonStyle} onClick={create} disabled={busy || !name.trim()}>
              {busy ? t('common.saving') : t('companies.create')}
            </button>
          </div>
        </div>
      )}

      {companies.length === 0 ? (
        <p style={emptyStyle}>{t('companies.empty')}</p>
      ) : (
        <ul style={listStyle}>
          {companies.map((company) => (
            <li key={company.id}>
              <button
                type="button"
                onClick={() => onSelect(company.id)}
                aria-current={company.id === selectedId ? 'true' : undefined}
                style={{
                  ...listRowStyle,
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderColor: company.id === selectedId ? 'var(--seat-ceo)' : 'var(--border-subtle)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Icon name="workspace" size={18} />
                  <span style={{ minWidth: 0 }}>
                    <b style={{ display: 'block' }}>{company.name}</b>
                    <small style={mutedStyle}>
                      {[company.stage, company.sector, company.country].filter(Boolean).join(' · ') || t('companies.noFacts')}
                    </small>
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={gapChipStyle}>{t('companies.projectCount', { count: company.projectCount })}</span>
                  <span style={gapChipStyle}>{t('companies.roomCount', { count: company.dataRoomCount })}</span>
                  {company.openGaps > 0 && (
                    <span style={{ ...gapChipStyle, color: 'var(--text-primary)' }}>
                      {t('companies.gapCount', { count: company.openGaps })}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedId != null && (
        <CompanyWork detail={detail} loading={detailLoading} onChanged={onDetailChanged} companyId={selectedId} />
      )}
    </div>
  );
}

/**
 * What the selected company OWNS — the IN-1 edge, made operable.
 *
 * The picker lists projects with no company yet. It is the only writer of
 * `projects.company_id` a founder ever touches, and detaching restores the null
 * rather than deleting anything: the delivery history outlives the record of who
 * it was for.
 */
function CompanyWork({
  companyId,
  detail,
  loading,
  onChanged,
}: {
  companyId: number;
  detail: CompanyDetail | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('investor');
  const [available, setAvailable] = useState<CompanyProject[]>([]);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consolidating, setConsolidating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    investorApi.projects
      .available(companyId)
      .then((rows) => { if (!cancelled) setAvailable(rows); })
      .catch(() => { if (!cancelled) setAvailable([]); });
    return () => { cancelled = true; };
  }, [companyId, detail]);

  const attach = useCallback(() => {
    const projectId = Number(chosen);
    if (!Number.isFinite(projectId) || projectId <= 0) return;
    setBusy(true);
    setError(null);
    investorApi.projects
      .attach(companyId, projectId)
      .then(() => { setChosen(''); onChanged(); })
      .catch((cause: unknown) => setError(message(cause, t('error.attachProject'))))
      .finally(() => setBusy(false));
  }, [chosen, companyId, onChanged, t]);

  const detach = useCallback((projectId: number) => {
    setBusy(true);
    setError(null);
    investorApi.projects
      .detach(companyId, projectId)
      .then(onChanged)
      .catch((cause: unknown) => setError(message(cause, t('error.detachProject'))))
      .finally(() => setBusy(false));
  }, [companyId, onChanged, t]);

  if (loading && !detail) return <p style={mutedStyle}>{t('common.loading')}</p>;
  if (!detail) return null;

  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-body)' }}>{t('companies.workTitle', { name: detail.name })}</h3>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" style={buttonStyle} onClick={() => setConsolidating(true)}>
            {t('companies.consolidate')}
          </button>
          <span style={gapChipStyle}>{t('companies.readiness', { percent: detail.readiness })}</span>
        </span>
      </div>
      {consolidating && (
        <ConsolidateProjectsPanel
          companyId={companyId}
          companyName={detail.name}
          open
          onClose={() => setConsolidating(false)}
          onDone={onChanged}
        />
      )}
      <p style={mutedStyle}>{t('companies.workBlurb')}</p>

      {error && <p style={errorStyle} role="alert">{error}</p>}

      {detail.projects.length === 0 ? (
        <p style={emptyStyle}>{t('companies.noProjects')}</p>
      ) : (
        <ul style={{ ...listStyle, marginTop: 10 }}>
          {detail.projects.map((project) => (
            <li key={project.id} style={listRowStyle}>
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block' }}>{project.name}</b>
                <small style={mutedStyle}>{project.key} · {project.status}</small>
              </span>
              <button type="button" style={buttonStyle} onClick={() => detach(project.id)} disabled={busy}>
                {t('companies.detach')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={labelStyle} htmlFor="attach-project">{t('companies.attachLabel')}</label>
          <Select id="attach-project" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            <option value="">{t('companies.attachPlaceholder')}</option>
            {available.map((project) => (
              <option key={project.id} value={String(project.id)}>{project.name} ({project.key})</option>
            ))}
          </Select>
        </div>
        <button type="button" style={buttonStyle} onClick={attach} disabled={busy || !chosen}>
          {t('companies.attach')}
        </button>
      </div>
      {available.length === 0 && <p style={mutedStyle}>{t('companies.nothingToAttach')}</p>}
    </div>
  );
}
