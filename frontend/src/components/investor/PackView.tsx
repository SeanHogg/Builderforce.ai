/**
 * The fundraising pack — the founder's entry point (IN-4).
 *
 * ── IT IS THE RFP PIPELINE, NOT A SECOND ONE ────────────────────────────────
 * `rfpService` already produces the right shape: a freshness-gated,
 * portfolio-matched, narrative-and-risks document with a P&L, a co-branded
 * render and a deterministic fallback for every model step. What it lacked was a
 * founder-facing way in and company-scoped inputs. So building a pack composes an
 * `rfp_requests` row from this company — its projects (IN-1), its round, its open
 * diligence — and hands it to the same generator. The document is opened through
 * the SAME renderer a tender response is, which is why the two can never quote
 * different numbers.
 *
 * ── THE CLAIM-TO-PROOF LINE IS RENDERED, NOT RESTATED ───────────────────────
 * No accounting adapter has run against live production data, so the pack's
 * financial section is built from declared inputs and from spend this workspace
 * has observed — it is NOT read from connected books. That sentence arrives on
 * the response as `grounding.notice` and is rendered verbatim. Writing it a
 * second time in page copy would be a claim free to outrun the code the day an
 * adapter does land.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { Icon } from '@/components/ui/Icon';
import { investorApi, packDocumentUrl, type BuiltPack, type CompanyDetail, type PackSummary } from '@/lib/investorApi';
import {
  buttonStyle, cardStyle, emptyStyle, errorStyle, gapChipStyle, inputStyle, labelStyle,
  listRowStyle, listStyle, message, mutedStyle, primaryButtonStyle, rowStyle, sectionStyle,
} from './investorStyles';

export function PackView({
  detail,
  packs,
  onChanged,
}: {
  detail: CompanyDetail | null;
  packs: PackSummary[];
  onChanged: () => void;
}) {
  const t = useTranslations('investor');
  const [projectId, setProjectId] = useState('');
  const [audience, setAudience] = useState('');
  const [emphasis, setEmphasis] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [built, setBuilt] = useState<BuiltPack | null>(null);

  const companyId = detail?.id ?? null;

  const build = useCallback(() => {
    if (companyId == null) return;
    setBusy(true);
    setError(null);
    investorApi.pack
      .build(companyId, {
        // '' means "let the server pick the most recent project"; 'none' is the
        // founder choosing the greenfield path. Those are different answers, and
        // the wire keeps them different.
        ...(projectId === 'none' ? { projectId: null } : projectId ? { projectId: Number(projectId) } : {}),
        audience: audience.trim() || null,
        emphasis: emphasis.trim() || null,
      })
      .then((pack) => { setBuilt(pack); onChanged(); })
      .catch((cause: unknown) => setError(message(cause, t('error.buildPack'))))
      .finally(() => setBusy(false));
  }, [audience, companyId, emphasis, onChanged, projectId, t]);

  if (!detail) return <p style={mutedStyle}>{t('common.pickCompany')}</p>;

  const latest = packs[0];
  const grounding = built?.grounding ?? latest?.grounding ?? null;

  return (
    <div style={sectionStyle}>
      <h2 style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('pack.title', { name: detail.name })}</h2>
      <p style={mutedStyle}>{t('pack.blurb')}</p>

      {error && <p style={errorStyle} role="alert">{error}</p>}

      <div style={cardStyle}>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <label style={labelStyle} htmlFor="pack-project">{t('pack.groundOn')}</label>
            <Select id="pack-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t('pack.groundAuto')}</option>
              {detail.projects.map((project) => (
                <option key={project.id} value={String(project.id)}>{project.name} ({project.key})</option>
              ))}
              <option value="none">{t('pack.groundNone')}</option>
            </Select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="pack-audience">{t('pack.audience')}</label>
            <input id="pack-audience" style={inputStyle} value={audience} onChange={(e) => setAudience(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pack-emphasis">{t('pack.emphasis')}</label>
            <input id="pack-emphasis" style={inputStyle} value={emphasis} onChange={(e) => setEmphasis(e.target.value)} />
          </div>
        </div>

        {detail.projects.length === 0 && <p style={mutedStyle}>{t('pack.noProjects')}</p>}
        {detail.gaps.length > 0 && <p style={mutedStyle}>{t('pack.gapsWarning', { count: detail.gaps.length })}</p>}

        <div style={{ marginTop: 12 }}>
          <button type="button" style={primaryButtonStyle} onClick={build} disabled={busy}>
            {busy ? t('pack.building') : t('pack.build')}
          </button>
        </div>
      </div>

      {/* The grounding sentence comes off the RESPONSE. Rendered, never retyped:
          the day an accounting adapter runs against live data, the server's own
          copy changes and this changes with it. */}
      {grounding && (
        <p style={{ ...mutedStyle, borderLeft: '2px solid var(--border-subtle)', paddingLeft: 10 }} role="note">
          {grounding.notice}
        </p>
      )}

      {built && (
        <div style={cardStyle} role="status">
          <div style={rowStyle}>
            <b>{t('pack.builtTitle')}</b>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={gapChipStyle}>{t('pack.projectsCited', { count: built.projectsCited })}</span>
              <span style={gapChipStyle}>{t('pack.openGaps', { count: built.openGaps })}</span>
            </span>
          </div>
          {built.responseId && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <a style={buttonStyle} href={packDocumentUrl(built.responseId)} target="_blank" rel="noopener noreferrer">
                {t('pack.open')}
              </a>
              <a style={buttonStyle} href={packDocumentUrl(built.responseId, 'pdf')} target="_blank" rel="noopener noreferrer">
                {t('pack.pdf')}
              </a>
            </div>
          )}
        </div>
      )}

      {packs.length === 0 ? (
        <p style={emptyStyle}>{t('pack.empty')}</p>
      ) : (
        <ul style={listStyle}>
          {packs.flatMap((pack) => pack.responses.map((response) => (
            <li key={response.id} style={listRowStyle}>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                <Icon name="document" size={18} />
                <span style={{ minWidth: 0 }}>
                  <b style={{ display: 'block' }}>{pack.title}</b>
                  <small style={mutedStyle}>{t('pack.generatedOn', { date: response.createdAt.slice(0, 10) })} · {response.status}</small>
                </span>
              </span>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a style={buttonStyle} href={packDocumentUrl(response.id)} target="_blank" rel="noopener noreferrer">
                  {t('pack.open')}
                </a>
                <a style={buttonStyle} href={packDocumentUrl(response.id, 'pdf')} target="_blank" rel="noopener noreferrer">
                  {t('pack.pdf')}
                </a>
              </span>
            </li>
          )))}
        </ul>
      )}
    </div>
  );
}
