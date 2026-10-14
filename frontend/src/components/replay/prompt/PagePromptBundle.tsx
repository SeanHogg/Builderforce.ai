/**
 * ONE prompt for a page (PRD 33 §4.1 "Apply all", §5.2 "Prompt"): the chosen
 * accepted fixes on one page, compiled by the API into one improvement prompt
 * (`replayApi.pagePrompt` with their ids) for the audience picked here. Copy
 * records each fix as applied by hand (`copy-prompt`); where the host has a
 * composer (the canvas), "Apply in composer" records `apply-in-composer` on each
 * fix that offers it and puts the composer prompt in the ONE composer as a draft.
 *
 * Used by the page review (its checkboxes) and by Do next's "Apply all".
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImprovementAudience, ReplayImprovementPromptDto, ReplayPrescriptionDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { RoleGate } from '@/components/RoleGate';
import { Icon } from '@/components/ui/Icon';
import { composerTargets, useComposerBridge } from '@/components/insights/composerBridge';
import { AudienceSwitch } from './AudienceSwitch';
import { PromptBox } from './PromptBox';
import { useRecordPromptCopy } from './useRecordPromptCopy';

export interface PagePromptBundleProps {
  siteId: string;
  path: string;
  /** The fixes to bundle (the API keeps only the accepted ones). */
  fixes: readonly ReplayPrescriptionDto[];
}

export function PagePromptBundle({ siteId, path, fixes }: PagePromptBundleProps) {
  const t = useTranslations('replay.prompt');
  const errorText = useErrorText();
  const bridge = useComposerBridge();
  const recordCopy = useRecordPromptCopy(siteId);
  const [audience, setAudience] = useState<ImprovementAudience>(bridge ? 'composer' : 'coding_agent');
  const [compiled, setCompiled] = useState<ReplayImprovementPromptDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const idsKey = fixes.map((p) => p.id).join(',');
  const composable = fixes.filter((p) => p.next.includes('apply-in-composer'));

  useEffect(() => {
    setCompiled(null);
    setError('');
    if (!idsKey) return undefined;
    let live = true;
    setLoading(true);
    replayApi.pagePrompt(siteId, path, audience, idsKey.split(','))
      .then((answer) => { if (live) setCompiled(answer); })
      .catch((failure: unknown) => { if (live) setError(errorText(failure)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // errorText is a stable formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, path, audience, idsKey]);

  const applyInComposer = async () => {
    if (!bridge) return;
    setApplying(true);
    setError('');
    try {
      await Promise.all(composable.map((p) => replayApi.actOnPrescription(siteId, p.id, 'apply-in-composer')));
      const draft = audience === 'composer' && compiled ? compiled : await replayApi.pagePrompt(siteId, path, 'composer', idsKey.split(','));
      bridge.applyToComposer({ prompt: draft.prompt, targets: composerTargets(draft), pagePath: path });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setApplying(false);
    }
  };

  if (!idsKey) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('noneChosen')}</p>;
  const included = compiled ? fixes.filter((p) => compiled.prescriptionIds.includes(p.id)) : [];
  return (
    <section aria-label={t('pageTitle')} data-testid="page-prompt-bundle" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <AudienceSwitch value={audience} onChange={setAudience} />
      {loading && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>}
      {error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{error}</p>}
      {compiled && (
        <>
          <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('bundled', { count: compiled.prescriptionIds.length })}</p>
          <PromptBox prompt={compiled.prompt} onCopied={recordCopy(included, audience)} />
        </>
      )}
      {bridge && composable.length > 0 && (
        <RoleGate capability="insights.actOnFixes">
          <button type="button" className="btn-secondary" data-action="bundle-apply-in-composer" style={{ minHeight: 44, alignSelf: 'flex-start' }} disabled={applying} aria-busy={applying} onClick={() => void applyInComposer()}>
            <Icon name="sparkles" size={14} /> {t('applyInComposer')}
          </button>
        </RoleGate>
      )}
    </section>
  );
}
