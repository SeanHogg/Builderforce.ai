/**
 * The `fix` kind's Prompt tab (PRD 33 §4.1 Change · Prompt · Measure, §5.2 "Prompt"):
 * the fix as an improvement prompt for the audience picked here — the ONE composer,
 * a coding agent, or any site builder's AI — compiled by the API on read, never
 * stored. Copy records the fix as applied by hand (`copy-prompt`). Where the fix's
 * page has accepted fixes, "Apply to the page" bundles all of them into one prompt
 * (`apply-page`, which records each).
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImprovementAudience, ReplayImprovementPromptDto, ReplayPrescriptionDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { RoleGate } from '@/components/RoleGate';
import { Icon } from '@/components/ui/Icon';
import { AudienceSwitch } from '@/components/replay/prompt/AudienceSwitch';
import { PromptBox } from '@/components/replay/prompt/PromptBox';
import { useRecordPromptCopy } from '@/components/replay/prompt/useRecordPromptCopy';
import { useComposerBridge } from '../composerBridge';
import type { InsightPanelKindProps } from '../panelKinds';
import { PanelPending } from './PanelPending';
import { usePrescription } from './FixKind';

const heading = { margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' } as const;

export function FixPrompt({ siteId, prescription: p, onChanged }: { siteId: string; prescription: ReplayPrescriptionDto; onChanged: (next: ReplayPrescriptionDto) => void }) {
  const t = useTranslations('replay.prompt');
  const errorText = useErrorText();
  const recordCopy = useRecordPromptCopy(siteId);
  const bridge = useComposerBridge();
  const [audience, setAudience] = useState<ImprovementAudience>(bridge ? 'composer' : 'coding_agent');
  const [compiled, setCompiled] = useState<ReplayImprovementPromptDto | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState<{ prompt: string; count: number } | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let live = true;
    setCompiled(null);
    setError('');
    replayApi.improvementPrompt(siteId, p.id, audience)
      .then((answer) => { if (live) setCompiled(answer); })
      .catch((failure: unknown) => { if (live) setError(errorText(failure)); });
    return () => { live = false; };
    // errorText is a stable formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, p.id, audience]);

  const applyPage = async () => {
    setApplying(true);
    setError('');
    try {
      const result = await replayApi.actOnPrescription(siteId, p.id, 'apply-page', { audience });
      if (result.prompt) setPage({ prompt: result.prompt, count: result.prescriptionIds?.length ?? 1 });
      onChanged(result.prescription);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div data-testid="fix-prompt" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('intro')}</p>
      <AudienceSwitch value={audience} onChange={(next) => { setAudience(next); setPage(null); }} />
      {error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{error}</p>}
      {!compiled && !error && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>}
      {compiled && <PromptBox prompt={compiled.prompt} onCopied={recordCopy([p], audience)} />}
      {(p.next.includes('apply-page') || page) && p.pagePath && (
        <section aria-label={t('pageTitle')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <h3 style={heading}>{t('pageTitle')}</h3>
          {p.next.includes('apply-page') && (
            <>
              <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('pageBody', { route: p.pagePath })}</p>
              <RoleGate capability="insights.actOnFixes">
                <button type="button" className="btn-secondary" data-action="apply-page" style={{ minHeight: 44, alignSelf: 'flex-start' }} disabled={applying} aria-busy={applying} onClick={() => void applyPage()}>
                  <Icon name="document" size={14} /> {t('applyPage')}
                </button>
              </RoleGate>
            </>
          )}
          {page && (
            <>
              <p role="status" style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('bundled', { count: page.count })}</p>
              {/* apply-page recorded every fix it bundled: the copy records nothing more. */}
              <PromptBox prompt={page.prompt} />
            </>
          )}
        </section>
      )}
    </div>
  );
}

export function FixPromptTab({ siteId, id }: InsightPanelKindProps) {
  const { data, loading, error, setData } = usePrescription(siteId, id);
  if (!data) return <PanelPending loading={loading} error={error} />;
  return <FixPrompt siteId={siteId} prescription={data} onChanged={setData} />;
}
