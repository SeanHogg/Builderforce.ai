/**
 * One candidate, in a SLIDE-OUT — the résumé the employer holds, the decision that moves
 * them, and the offer that closes it.
 *
 * A slide-out and not a modal: the app-wide convention reserves a centred dialog for
 * terminal destructive approvals, and this is a detail view with forms in it. The board
 * stays visible behind it, which is the point — a recruiter deciding on one candidate is
 * comparing them against the column they are in.
 *
 * ── THE RÉSUMÉ IS THE EMPLOYER'S COPY ────────────────────────────────────────────
 * What is rendered is `candidate_resumes`, the snapshot taken when the person applied —
 * never a live read of their own document store, which holds the versions they tailored
 * for this employer's competitors. That separation is `candidateResumeProjection.ts`'s
 * and this component inherits it by reading the projection the API returns.
 *
 * ── A DECISION IS THE MOVE ───────────────────────────────────────────────────────
 * The decision form does not ask which stage to go to. `advance` goes to the next stage,
 * `reject` to the sink, `offer` and `hire` to theirs — the server owns that mapping, so a
 * decision recorded here and one recorded by an API client land in the same column.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { useFormat } from '@/i18n/useFormat';
import type { AtsCandidateDossier, AtsDecision, AtsOffer, AtsVocabulary } from '@/lib/hiringApi';
import { buttonStyle, cardStyle, chipStyle, inputStyle, labelStyle, mutedStyle, primaryButtonStyle, candidateLabel } from './hiringStyles';

export interface CandidateDrawerProps {
  open: boolean;
  onClose: () => void;
  dossier: AtsCandidateDossier | null;
  vocabulary: AtsVocabulary | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  onDecide: (decision: string, rationale: string) => Promise<void>;
  onDraftOffer: (input: { title: string; baseSalary: number | null; currency: string; startDate: string | null }) => Promise<void>;
  onSendOffer: (offerId: number, party: { name: string; email: string }) => Promise<void>;
  onRespondOffer: (offerId: number, response: 'accepted' | 'declined') => Promise<void>;
}

export function CandidateDrawer(props: CandidateDrawerProps) {
  const t = useTranslations('ats');
  const { dossier } = props;
  const title = dossier ? candidateLabel(dossier.application.headline, dossier.application.candidateRef) : t('drawer.loading');

  return (
    <SlideOutPanel
      open={props.open}
      onClose={props.onClose}
      title={title}
      crumb={t('drawer.crumb')}
      width="wide"
      widthStorageKey="hiring-candidate"
    >
      {props.loading && <p style={mutedStyle}>{t('drawer.loading')}</p>}
      {props.error && <p style={{ ...mutedStyle, color: 'var(--danger-text)' }}>{props.error}</p>}
      {dossier && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Summary dossier={dossier} />
          <ResumeSection dossier={dossier} />
          <DecisionSection
            decisions={dossier.decisions}
            vocabulary={props.vocabulary}
            saving={props.saving}
            onDecide={props.onDecide}
          />
          <OfferSection
            offers={dossier.offers}
            candidateHeadline={dossier.application.headline}
            saving={props.saving}
            onDraft={props.onDraftOffer}
            onSend={props.onSendOffer}
            onRespond={props.onRespondOffer}
          />
        </div>
      )}
    </SlideOutPanel>
  );
}

function Summary({ dossier }: { dossier: AtsCandidateDossier }) {
  const t = useTranslations('ats');
  const fmt = useFormat();
  const { application } = dossier;
  return (
    <section style={cardStyle}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <span style={chipStyle}>{application.status}</span>
        <span style={chipStyle}>{application.source}</span>
        {application.yearsExp === null ? null : <span style={chipStyle}>{t('card.years', { years: application.yearsExp })}</span>}
      </div>
      <p style={{ ...mutedStyle, marginTop: 8, marginBottom: 0 }}>
        {t('drawer.appliedAt', { date: fmt.date(application.appliedAt) })}
      </p>
      {application.rejectReason && (
        <p style={{ ...mutedStyle, marginTop: 4, marginBottom: 0 }}>
          {t('drawer.rejectedFor', { reason: application.rejectReason })}
        </p>
      )}
      {/* The full ref, because the short one on the card is not enough to look somebody
          up in a support conversation. */}
      <p style={{ ...mutedStyle, marginTop: 8, marginBottom: 0, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
        {application.candidateRef}
      </p>
    </section>
  );
}

function ResumeSection({ dossier }: { dossier: AtsCandidateDossier }) {
  const t = useTranslations('ats');
  const { resume, application } = dossier;
  return (
    <section style={cardStyle}>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{t('drawer.resumeTitle')}</h3>
      {resume ? (
        <>
          {resume.headline && <p style={{ fontSize: 13, marginTop: 6, marginBottom: 0 }}>{resume.headline}</p>}
          {resume.skills.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {resume.skills.slice(0, 24).map((skill) => <span key={skill} style={chipStyle}>{skill}</span>)}
            </div>
          )}
        </>
      ) : (
        <p style={{ ...mutedStyle, marginTop: 6, marginBottom: 0 }}>{t('drawer.noResume')}</p>
      )}
      {application.coverLetter && (
        <>
          <h4 style={{ fontSize: 12, fontWeight: 700, marginTop: 12, marginBottom: 4 }}>{t('drawer.coverLetter')}</h4>
          <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', margin: 0 }}>{application.coverLetter}</p>
        </>
      )}
    </section>
  );
}

function DecisionSection({
  decisions, vocabulary, saving, onDecide,
}: { decisions: AtsDecision[]; vocabulary: AtsVocabulary | null; saving: boolean; onDecide: (decision: string, rationale: string) => Promise<void> }) {
  const t = useTranslations('ats');
  const fmt = useFormat();
  const [decision, setDecision] = useState('advance');
  const [rationale, setRationale] = useState('');
  const options = vocabulary?.decisions ?? [];
  // A rejection without a reason is refused by the server, so the button says so here
  // rather than letting somebody discover it as an error after they clicked.
  const needsRationale = decision === 'reject' && !rationale.trim();

  return (
    <section style={cardStyle}>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{t('decision.title')}</h3>
      <p style={{ ...mutedStyle, marginTop: 4 }}>{t('decision.explainer')}</p>

      <RoleGate capability="hiring.manage" variant="block" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <label style={labelStyle} htmlFor="ats-decision">{t('decision.field')}</label>
            <Select id="ats-decision" value={decision} onChange={(event) => setDecision(event.target.value)} style={inputStyle}>
              {options.map((option) => (
                <option key={option} value={option}>{t(`decision.kind.${option}` as never)}</option>
              ))}
            </Select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="ats-rationale">{t('decision.rationale')}</label>
            <textarea
              id="ats-rationale"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              rows={3}
              placeholder={t('decision.rationalePlaceholder')}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          <button
            type="button"
            disabled={saving || needsRationale}
            style={{ ...primaryButtonStyle, opacity: saving || needsRationale ? 0.6 : 1 }}
            onClick={() => { void onDecide(decision, rationale).then(() => setRationale('')); }}
          >
            {needsRationale ? t('decision.needsRationale') : t('decision.submit')}
          </button>
        </div>
      </RoleGate>

      {decisions.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {decisions.map((entry) => (
            <li key={entry.id} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={chipStyle}>{t(`decision.kind.${entry.decision}` as never)}</span>
                <span style={mutedStyle}>{fmt.dateTime(entry.decidedAt)}</span>
              </div>
              {entry.rationale && <p style={{ fontSize: 13, margin: '4px 0 0' }}>{entry.rationale}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OfferSection({
  offers, candidateHeadline, saving, onDraft, onSend, onRespond,
}: {
  offers: AtsOffer[];
  candidateHeadline: string | null;
  saving: boolean;
  onDraft: (input: { title: string; baseSalary: number | null; currency: string; startDate: string | null }) => Promise<void>;
  onSend: (offerId: number, party: { name: string; email: string }) => Promise<void>;
  onRespond: (offerId: number, response: 'accepted' | 'declined') => Promise<void>;
}) {
  const t = useTranslations('ats');
  const fmt = useFormat();
  const [title, setTitle] = useState('');
  const [salary, setSalary] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [startDate, setStartDate] = useState('');
  const [name, setName] = useState(candidateHeadline ?? '');
  const [email, setEmail] = useState('');

  const live = offers.find((offer) => offer.status === 'draft' || offer.status === 'approved' || offer.status === 'sent');

  return (
    <section style={cardStyle}>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{t('offer.title')}</h3>

      {offers.map((offer) => (
        <div key={offer.id} style={{ borderTop: '1px solid var(--border-subtle)', marginTop: 10, paddingTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13 }}>{offer.title}</strong>
            <span style={chipStyle}>{t(`offer.status.${offer.status}` as never)}</span>
            {offer.signatureRequestId !== null && <span style={chipStyle}>{t('offer.signatureRef', { id: offer.signatureRequestId })}</span>}
          </div>
          <p style={{ ...mutedStyle, margin: '4px 0 0' }}>
            {offer.baseSalary ? `${offer.currency} ${offer.baseSalary}` : t('offer.noSalary')}
            {offer.startDate ? ` · ${t('offer.starts', { date: fmt.date(offer.startDate) })}` : ''}
          </p>

          {(offer.status === 'draft' || offer.status === 'approved') && (
            <RoleGate capability="hiring.manage" variant="block" style={{ marginTop: 8 }}>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                <div>
                  <label style={labelStyle} htmlFor={`ats-party-name-${offer.id}`}>{t('offer.partyName')}</label>
                  <input id={`ats-party-name-${offer.id}`} value={name} onChange={(event) => setName(event.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle} htmlFor={`ats-party-email-${offer.id}`}>{t('offer.partyEmail')}</label>
                  <input id={`ats-party-email-${offer.id}`} type="email" value={email} onChange={(event) => setEmail(event.target.value)} style={inputStyle} />
                </div>
              </div>
              <button
                type="button"
                disabled={saving || !name.trim() || !email.includes('@')}
                style={{ ...primaryButtonStyle, marginTop: 8, opacity: saving || !name.trim() || !email.includes('@') ? 0.6 : 1 }}
                onClick={() => { void onSend(offer.id, { name: name.trim(), email: email.trim() }); }}
              >
                {t('offer.send')}
              </button>
              <p style={{ ...mutedStyle, marginTop: 6, marginBottom: 0 }}>{t('offer.sendExplainer')}</p>
            </RoleGate>
          )}

          {offer.status === 'sent' && (
            <RoleGate capability="hiring.manage" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" disabled={saving} style={primaryButtonStyle} onClick={() => { void onRespond(offer.id, 'accepted'); }}>
                {t('offer.markAccepted')}
              </button>
              <button type="button" disabled={saving} style={buttonStyle} onClick={() => { void onRespond(offer.id, 'declined'); }}>
                {t('offer.markDeclined')}
              </button>
            </RoleGate>
          )}
        </div>
      ))}

      {live ? (
        <p style={{ ...mutedStyle, marginTop: 10, marginBottom: 0 }}>{t('offer.oneLive')}</p>
      ) : (
        <RoleGate capability="hiring.manage" variant="block" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <div>
              <label style={labelStyle} htmlFor="ats-offer-title">{t('offer.roleTitle')}</label>
              <input id="ats-offer-title" value={title} onChange={(event) => setTitle(event.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="ats-offer-salary">{t('offer.baseSalary')}</label>
              <input id="ats-offer-salary" inputMode="decimal" value={salary} onChange={(event) => setSalary(event.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="ats-offer-currency">{t('offer.currency')}</label>
              <input id="ats-offer-currency" value={currency} onChange={(event) => setCurrency(event.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle} htmlFor="ats-offer-start">{t('offer.startDate')}</label>
              <input id="ats-offer-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} style={inputStyle} />
            </div>
          </div>
          <button
            type="button"
            disabled={saving || !title.trim()}
            style={{ ...primaryButtonStyle, marginTop: 8, opacity: saving || !title.trim() ? 0.6 : 1 }}
            onClick={() => {
              const parsed = Number(salary);
              void onDraft({
                title: title.trim(),
                baseSalary: salary.trim() && Number.isFinite(parsed) ? parsed : null,
                currency: currency.trim() || 'USD',
                startDate: startDate || null,
              }).then(() => { setTitle(''); setSalary(''); setStartDate(''); });
            }}
          >
            {t('offer.draft')}
          </button>
        </RoleGate>
      )}
    </section>
  );
}
