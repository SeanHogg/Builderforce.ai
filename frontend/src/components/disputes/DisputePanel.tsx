/**
 * ONE DISPUTE, AND EVERY MOVE THE VIEWER MAY MAKE ON IT.
 *
 * Rendered by both sides and by the mediator. What differs between them is passed IN
 * (`viewer`, `authority`) rather than worked out here, for the same reason a milestone's
 * `actions` come from the server: a second copy of "who may do what" in the browser is a
 * second place for the rule to drift, and the copy that drifts is the one offering a
 * button the server then refuses.
 *
 * ── THE MONEY IS SHOWN BEFORE THE RULING IS MADE ─────────────────────────────────
 * A mediator picking `split` sees both halves update as they type, because the client's
 * share is the REMAINDER of the pot and a ruling made without seeing it is a ruling made
 * with half the facts. The number sent is still only the freelancer's share — the server
 * computes the other, so two halves can never fail to add up.
 *
 * ── WHY BOTH POSITIONS ARE ALWAYS VISIBLE ────────────────────────────────────────
 * Mediation that shows each side only its own filing is arbitration by correspondence.
 * Both positions and their evidence render for everyone, so a person can see what they
 * are answering.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { useMoneyFormat } from '@/lib/useMoneyFormat';
import { Select } from '@/components/Select';
import {
  DISPUTE_OUTCOMES,
  isDisputeLive,
  type Dispute,
  type DisputeEvidence,
  type DisputeOutcome,
  type MediatorAuthority,
} from '@/lib/disputesApi';

/** Which side is looking. Decided by the surface that mounted this, from the token it
 *  holds — never guessed from the dispute row. */
export type DisputeViewer = 'client' | 'freelancer';

const STATUS_TONE: Record<Dispute['status'], string> = {
  open: 'var(--warning-text)',
  mediating: 'var(--cyan-bright)',
  resolved: 'var(--success)',
  withdrawn: 'var(--text-muted)',
};

export interface DisputePanelActions {
  fileStatement: (disputeId: number, position: string, evidence: DisputeEvidence[]) => Promise<void>;
  withdraw?: (disputeId: number) => Promise<void>;
  startMediation?: (disputeId: number) => Promise<void>;
  resolve?: (input: {
    disputeId: number;
    outcome: DisputeOutcome;
    splitFreelancerCents: number | null;
    resolution: string;
  }) => Promise<void>;
}

export function DisputePanel({
  dispute,
  viewer,
  viewerRef,
  authority = 'none',
  actions,
}: {
  dispute: Dispute;
  viewer: DisputeViewer;
  /** The viewer's own user id — used only to decide whether they may withdraw, which is
   *  the one action reserved for whoever raised it. */
  viewerRef: string | null;
  authority?: MediatorAuthority;
  actions: DisputePanelActions;
}) {
  const t = useTranslations('disputes');
  const fmt = useFormat();
  const { formatCents } = useMoneyFormat();

  const [position, setPosition] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [evidence, setEvidence] = useState<DisputeEvidence[]>([]);
  const [outcome, setOutcome] = useState<DisputeOutcome>('split');
  const [splitShare, setSplitShare] = useState('');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const live = isDisputeLive(dispute.status);
  const canMediate = authority !== 'none' && live;
  const canWithdraw = live && !!viewerRef && dispute.raisedByRef === viewerRef && !!actions.withdraw;

  const mine = useMemo(
    () => dispute.statements.find((statement) => statement.party === viewer) ?? null,
    [dispute.statements, viewer],
  );

  const splitCents = Math.round(Number(splitShare) * 100);
  const splitValid = outcome !== 'split'
    || (Number.isFinite(splitCents) && splitCents > 0 && splitCents < dispute.amountCents);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <article style={{
      display: 'grid', gap: 12, padding: 18, borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-subtle)', background: 'var(--surface-card)',
    }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <h3 style={{
          margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700,
          color: 'var(--text-primary)', flex: '1 1 200px', minWidth: 0,
        }}>{dispute.milestoneTitle ?? t('untitledMilestone')}</h3>
        <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
          {formatCents(dispute.amountCents, { currency: dispute.currency })}
        </span>
        <span style={{
          fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, letterSpacing: '.08em',
          textTransform: 'uppercase', color: STATUS_TONE[dispute.status],
        }}>{t(`status.${dispute.status}`)}</span>
      </header>

      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
        {t('raisedBy', {
          party: t(`party.${dispute.raisedByParty}`),
          when: fmt.date(new Date(dispute.createdAtISO)),
          workspace: dispute.workspaceName ?? t('unknownWorkspace'),
        })}
      </p>
      <p style={{ margin: 0, color: 'var(--text-primary)', fontSize: 'var(--font-size-small)' }}>
        <strong>{dispute.reason}</strong>
        {dispute.detail && <span style={{ display: 'block', color: 'var(--text-secondary)' }}>{dispute.detail}</span>}
      </p>

      {/* Both filings, always — mediation that shows each side only its own is
          arbitration by correspondence. */}
      {dispute.statements.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {dispute.statements.map((statement) => (
            <li key={statement.party} style={{
              padding: '10px 12px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
            }}>
              <span style={{
                fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, letterSpacing: '.08em',
                textTransform: 'uppercase', color: 'var(--text-secondary)',
              }}>{t(`party.${statement.party}`)} · {fmt.date(new Date(statement.filedAtISO))}</span>
              <p style={{ margin: '4px 0 0', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)' }}>
                {statement.position}
              </p>
              {statement.evidence.length > 0 && (
                <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                  {statement.evidence.map((item) => (
                    <li key={item.url} style={{ fontSize: 'var(--font-size-eyebrow)' }}>
                      <a href={item.url} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--cyan-bright)' }}>
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {dispute.status === 'resolved' && dispute.outcome && (
        <p style={{
          margin: 0, padding: '10px 12px', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
          color: 'var(--text-primary)', fontSize: 'var(--font-size-small)',
        }}>
          <strong>{t(`outcome.${dispute.outcome}`)}</strong>{' '}
          {t('awardSummary', {
            freelancer: formatCents(dispute.awardFreelancerCents, { currency: dispute.currency }),
            client: formatCents(dispute.awardClientCents, { currency: dispute.currency }),
          })}
          {dispute.resolution && <span style={{ display: 'block', color: 'var(--text-secondary)' }}>{dispute.resolution}</span>}
          {dispute.settlement === 'manual' && (
            // The ledger is correct; the bank transfer is not automatic here.
            <span style={{ display: 'block', color: 'var(--text-secondary)' }}>{t('settlementManual')}</span>
          )}
        </p>
      )}

      {live && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await actions.fileStatement(dispute.id, position, evidence);
              setPosition('');
              setEvidence([]);
            });
          }}
          style={{ display: 'grid', gap: 8 }}
        >
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{
              fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)',
              textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600,
            }}>{mine ? t('revisePosition') : t('filePosition')}</span>
            <textarea
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              rows={3}
              required
              placeholder={t('positionPlaceholder')}
              style={{
                padding: '8px 10px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
                color: 'var(--text-primary)', maxWidth: '100%', resize: 'vertical',
              }}
            />
          </label>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input
              type="url"
              value={evidenceUrl}
              onChange={(event) => setEvidenceUrl(event.target.value)}
              placeholder={t('evidencePlaceholder')}
              style={{
                flex: '1 1 200px', minWidth: 0, padding: '8px 10px',
                borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
                background: 'var(--bg-base)', color: 'var(--text-primary)',
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!evidenceUrl.trim()}
              onClick={() => {
                setEvidence((current) => [...current, { label: evidenceUrl.trim(), url: evidenceUrl.trim() }]);
                setEvidenceUrl('');
              }}
            >{t('addEvidence')}</button>
          </div>

          {evidence.length > 0 && (
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {evidence.map((item) => (
                <li key={item.url} style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>
                  {item.label}
                </li>
              ))}
            </ul>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={busy || !position.trim()}>
              {busy ? t('working') : t('submitPosition')}
            </button>
            {canWithdraw && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void run(() => actions.withdraw!(dispute.id))}
              >{t('withdraw')}</button>
            )}
            {canMediate && dispute.status === 'open' && actions.startMediation && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void run(() => actions.startMediation!(dispute.id))}
              >{t('startMediation')}</button>
            )}
          </div>
        </form>
      )}

      {canMediate && actions.resolve && (
        <fieldset style={{
          display: 'grid', gap: 8, margin: 0, padding: 12,
          borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
          background: 'var(--bg-base)',
        }}>
          <legend style={{
            fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, letterSpacing: '.08em',
            textTransform: 'uppercase', color: 'var(--text-secondary)', padding: '0 4px',
          }}>{t('ruleHeading')}</legend>

          {/* Which kind of mediator is ruling, stated: the client IS the workspace, so a
              workspace-authority ruling is not a neutral one and must not look like one. */}
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-eyebrow)' }}>
            {t(`authority.${authority}`)}
          </p>

          <Select
            value={outcome}
            aria-label={t('outcomeLabel')}
            onChange={(event) => setOutcome(event.target.value as DisputeOutcome)}
          >
            {DISPUTE_OUTCOMES.map((option) => (
              <option key={option} value={option}>{t(`outcome.${option}`)}</option>
            ))}
          </Select>

          {outcome === 'split' && (
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{
                fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)',
                textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600,
              }}>{t('splitLabel')}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={splitShare}
                onChange={(event) => setSplitShare(event.target.value)}
                style={{
                  padding: '8px 10px', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)', background: 'var(--surface-card)',
                  color: 'var(--text-primary)', maxWidth: '100%',
                }}
              />
              {/* The remainder, shown live: a split ruled without seeing the other half
                  is a decision made with half the facts. */}
              <span style={{ fontSize: 'var(--font-size-eyebrow)', color: splitValid ? 'var(--text-secondary)' : 'var(--danger)' }}>
                {splitValid
                  ? t('splitRemainder', {
                    client: formatCents(Math.max(0, dispute.amountCents - splitCents), { currency: dispute.currency }),
                  })
                  : t('splitInvalid', { total: formatCents(dispute.amountCents, { currency: dispute.currency }) })}
              </span>
            </label>
          )}

          <textarea
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            rows={2}
            placeholder={t('resolutionPlaceholder')}
            style={{
              padding: '8px 10px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)', background: 'var(--surface-card)',
              color: 'var(--text-primary)', maxWidth: '100%', resize: 'vertical',
            }}
          />

          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !splitValid}
            onClick={() => void run(() => actions.resolve!({
              disputeId: dispute.id,
              outcome,
              splitFreelancerCents: outcome === 'split' ? splitCents : null,
              resolution,
            }))}
          >{busy ? t('working') : t('rule')}</button>
        </fieldset>
      )}

      {notice && (
        <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--font-size-small)' }}>
          {notice}
        </p>
      )}
    </article>
  );
}
