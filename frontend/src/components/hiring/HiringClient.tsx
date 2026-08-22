'use client';

/**
 * The Recruiter's working surface — pipeline, kits, offers.
 *
 * ── ONE CLIENT BOUNDARY ──────────────────────────────────────────────────────────
 * This is the only `'use client'` file in the hiring surface. Its siblings
 * (`PipelineBoard`, `CandidateDrawer`, `InterviewKitEditor`, `OffersPanel`) are ordinary
 * modules pulled into the client bundle by being imported from here — the directive marks
 * the BOUNDARY, and repeating it on every leaf adds files to a ratchet without adding
 * meaning.
 *
 * ── THE SHELL OWNS THE TABS, THIS OWNS THE BODY ──────────────────────────────────
 * The tab bar itself is rendered globally from `navGroups`; here `?tab=` picks the body,
 * exactly as `/quality` does. `?pipeline=` picks which posting's board is shown, so a
 * recruiter's link to "the board for this requisition" is a URL and not a click path.
 *
 * ── NOTHING HERE OWNS A QUERY OR A VOCABULARY ────────────────────────────────────
 * Every read goes through `atsApi`, and the stage names, decision kinds, kit stage kinds
 * and offer statuses all come from `/api/ats/vocabulary`. A component with its own copy
 * of the ladder is how a board comes to draw a column that no longer exists.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SourcingView } from '@/components/sourcing/SourcingView';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { ViewToggle } from '@/components/ViewToggle';
import { useRequireAuth } from '@/lib/useRequireAuth';
import {
  atsApi,
  type AtsBoard,
  type AtsCandidateDossier,
  type AtsCard,
  type AtsKit,
  type AtsKitStageInput,
  type AtsOffer,
  type AtsPipelineSummary,
  type AtsVocabulary,
} from '@/lib/hiringApi';
import { PipelineBoard } from './PipelineBoard';
import { CandidateDrawer } from './CandidateDrawer';
import { InterviewKitEditor } from './InterviewKitEditor';
import { OffersPanel } from './OffersPanel';
import { cardStyle, labelStyle, mutedStyle } from './hiringStyles';

type BoardView = 'board' | 'table';

const message = (error: unknown, fallback: string): string =>
  (error instanceof Error && error.message ? error.message : fallback);

export default function HiringClient() {
  const t = useTranslations('ats');
  const allowed = useRequireAuth();
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get('tab') ?? '';
  const pipelineFromUrl = params.get('pipeline');

  const [vocabulary, setVocabulary] = useState<AtsVocabulary | null>(null);
  const [pipelines, setPipelines] = useState<AtsPipelineSummary[]>([]);
  const [pipelineRef, setPipelineRef] = useState<string | null>(pipelineFromUrl);
  const [board, setBoard] = useState<AtsBoard | null>(null);
  const [kits, setKits] = useState<AtsKit[]>([]);
  const [offers, setOffers] = useState<AtsOffer[]>([]);
  const [view, setView] = useState<BoardView>('board');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyCandidateRef, setBusyCandidateRef] = useState<string | null>(null);

  const [openApplicationId, setOpenApplicationId] = useState<number | null>(null);
  const [dossier, setDossier] = useState<AtsCandidateDossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState<string | null>(null);

  // The vocabulary is the server's, read once. Everything that renders a stage, a decision
  // kind or an offer status reads it from here.
  useEffect(() => {
    if (!allowed) return;
    atsApi.vocabulary()
      .then(setVocabulary)
      .catch((cause: unknown) => setError(message(cause, t('error.vocabulary'))));
  }, [allowed, t]);

  const loadPipelines = useCallback(() => {
    setLoading(true);
    atsApi.pipelines()
      .then((rows) => {
        setPipelines(rows);
        // A pipeline is chosen for the reader when they have not chosen one: landing on a
        // picker with nothing selected makes the surface look empty when it is not.
        setPipelineRef((current) => current ?? rows[0]?.pipelineRef ?? null);
        setError(null);
      })
      .catch((cause: unknown) => setError(message(cause, t('error.pipelines'))))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { if (allowed) loadPipelines(); }, [allowed, loadPipelines]);

  const loadBoard = useCallback((ref: string) => {
    setLoading(true);
    atsApi.board(ref)
      .then((next) => { setBoard(next); setError(null); })
      .catch((cause: unknown) => setError(message(cause, t('error.board'))))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { if (allowed && pipelineRef) loadBoard(pipelineRef); }, [allowed, pipelineRef, loadBoard]);

  const loadKits = useCallback(() => {
    atsApi.kits.list()
      .then(setKits)
      .catch((cause: unknown) => setError(message(cause, t('error.kits'))));
  }, [t]);

  const loadOffers = useCallback(() => {
    setLoading(true);
    atsApi.offers.list()
      .then((rows) => { setOffers(rows); setError(null); })
      .catch((cause: unknown) => setError(message(cause, t('error.offers'))))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    if (!allowed) return;
    if (tab === 'kits') loadKits();
    if (tab === 'offers') loadOffers();
  }, [allowed, tab, loadKits, loadOffers]);

  /** Re-read everything a stage change can have altered. The board is authoritative; the
   *  picker's open counts move with it. */
  const refreshAfterWrite = useCallback(async () => {
    if (pipelineRef) await atsApi.board(pipelineRef).then(setBoard).catch(() => undefined);
    await atsApi.pipelines().then(setPipelines).catch(() => undefined);
  }, [pipelineRef]);

  const openCandidate = useCallback((applicationId: number) => {
    setOpenApplicationId(applicationId);
    setDossierLoading(true);
    setDossierError(null);
    atsApi.applications.read(applicationId)
      .then(setDossier)
      .catch((cause: unknown) => setDossierError(message(cause, t('error.candidate'))))
      .finally(() => setDossierLoading(false));
  }, [t]);

  const onMove = useCallback(async (card: AtsCard, toStage: string) => {
    if (!pipelineRef || toStage === card.stage) return;
    setBusyCandidateRef(card.candidateRef);
    try {
      await atsApi.move(pipelineRef, { candidateRef: card.candidateRef, toStage });
      await refreshAfterWrite();
      setError(null);
    } catch (cause) {
      setError(message(cause, t('error.move')));
    } finally {
      setBusyCandidateRef(null);
    }
  }, [pipelineRef, refreshAfterWrite, t]);

  /** A decision is the move, so the board is re-read straight after it — the candidate
   *  will have changed column without anybody dragging them. */
  const onDecide = useCallback(async (decision: string, rationale: string) => {
    if (openApplicationId === null) return;
    setSaving(true);
    try {
      await atsApi.applications.decide(openApplicationId, { decision, rationale: rationale || undefined });
      const [next] = await Promise.all([atsApi.applications.read(openApplicationId), refreshAfterWrite()]);
      setDossier(next);
      setDossierError(null);
    } catch (cause) {
      setDossierError(message(cause, t('error.decide')));
    } finally {
      setSaving(false);
    }
  }, [openApplicationId, refreshAfterWrite, t]);

  const onDraftOffer = useCallback(async (input: { title: string; baseSalary: number | null; currency: string; startDate: string | null }) => {
    if (openApplicationId === null) return;
    setSaving(true);
    try {
      await atsApi.offers.draft({ applicationId: openApplicationId, ...input });
      setDossier(await atsApi.applications.read(openApplicationId));
      setDossierError(null);
    } catch (cause) {
      setDossierError(message(cause, t('error.draftOffer')));
    } finally {
      setSaving(false);
    }
  }, [openApplicationId, t]);

  const onSendOffer = useCallback(async (offerId: number, party: { name: string; email: string }) => {
    if (openApplicationId === null) return;
    setSaving(true);
    try {
      await atsApi.offers.send(offerId, { parties: [party] });
      setDossier(await atsApi.applications.read(openApplicationId));
      setDossierError(null);
    } catch (cause) {
      setDossierError(message(cause, t('error.sendOffer')));
    } finally {
      setSaving(false);
    }
  }, [openApplicationId, t]);

  const onRespondOffer = useCallback(async (offerId: number, response: 'accepted' | 'declined') => {
    if (openApplicationId === null) return;
    setSaving(true);
    try {
      await atsApi.offers.respond(offerId, response);
      const [next] = await Promise.all([atsApi.applications.read(openApplicationId), refreshAfterWrite()]);
      setDossier(next);
      setDossierError(null);
    } catch (cause) {
      setDossierError(message(cause, t('error.respondOffer')));
    } finally {
      setSaving(false);
    }
  }, [openApplicationId, refreshAfterWrite, t]);

  const withKitSave = useCallback(async (run: () => Promise<unknown>) => {
    setSaving(true);
    try {
      await run();
      setKits(await atsApi.kits.list());
      setError(null);
    } catch (cause) {
      setError(message(cause, t('error.kitSave')));
    } finally {
      setSaving(false);
    }
  }, [t]);

  if (!allowed) return null;

  const selectPipeline = (ref: string) => {
    setPipelineRef(ref);
    // The chosen board is in the URL so it can be linked to and survives a reload.
    const next = new URLSearchParams(params.toString());
    next.set('pipeline', ref);
    router.replace(`/hiring?${next.toString()}`);
  };

  let heading = t('page.title');
  let subheading = t('page.subtitle');
  let bodyNode = (
    <>
      <div style={{ ...cardStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <label style={labelStyle} htmlFor="ats-pipeline">{t('board.pipeline')}</label>
          <Select
            id="ats-pipeline"
            value={pipelineRef ?? ''}
            onChange={(event) => selectPipeline(event.target.value)}
            style={{
              width: '100%', padding: '7px 10px', fontSize: 13,
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-base)', color: 'var(--text-primary)',
            }}
          >
            {pipelines.map((pipeline) => (
              <option key={pipeline.pipelineRef} value={pipeline.pipelineRef}>
                {/* A posting whose requisition was deleted keeps its candidates, so it is
                    named by its ref rather than dropped from the picker. */}
                {pipeline.title ?? pipeline.pipelineRef}
                {` (${pipeline.openCount})`}
              </option>
            ))}
          </Select>
        </div>
        <ViewToggle value={view} onChange={(next) => setView(next as BoardView)} board table />
      </div>
      {board ? (
        <PipelineBoard
          board={board}
          view={view}
          busyCandidateRef={busyCandidateRef}
          onOpenCandidate={(card) => { if (card.applicationId !== null) openCandidate(card.applicationId); }}
          onMove={onMove}
        />
      ) : (
        <p style={mutedStyle}>{loading ? t('board.loading') : t('board.noPipelines')}</p>
      )}
    </>
  );

  if (tab === 'kits') {
    heading = t('kits.title');
    subheading = t('kits.subtitle');
    bodyNode = (
      <InterviewKitEditor
        kits={kits}
        vocabulary={vocabulary}
        saving={saving}
        error={error}
        onSeedDefault={() => withKitSave(() => atsApi.kits.ensureDefault())}
        onSaveStages={(kitId, stages: AtsKitStageInput[]) => withKitSave(() => atsApi.kits.update(kitId, { stages }))}
        onMakeDefault={(kitId) => withKitSave(() => atsApi.kits.update(kitId, { isDefault: true }))}
        onCreate={(name) => withKitSave(() => atsApi.kits.create({ name }))}
        onDelete={(kitId) => withKitSave(() => atsApi.kits.remove(kitId))}
      />
    );
  } else if (tab === 'offers') {
    heading = t('offers.title');
    subheading = t('offers.subtitle');
    bodyNode = <OffersPanel offers={offers} loading={loading} onOpenCandidate={openCandidate} />;
  } else if (tab === 'sourcing') {
    // Sourcing brings its OWN data and its own entitlement decisions, so this
    // branch adds a body and nothing else — no fetch above, no state, no extra
    // condition in the effect that loads kits and offers.
    heading = t('sourcing.title');
    subheading = t('sourcing.subtitle');
    bodyNode = <SourcingView />;
  }

  return (
    <PageContainer>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{heading}</h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>{subheading}</p>
      </div>

      {error && tab !== 'kits' && <p style={{ ...mutedStyle, color: 'var(--danger-text)' }}>{error}</p>}

      {/* Disabled, never hidden: somebody without the role should be able to SEE that a
          hiring pipeline exists and know whose access to ask for. */}
      <RoleGate capability="hiring.view" variant="block">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{bodyNode}</div>
      </RoleGate>

      <CandidateDrawer
        open={openApplicationId !== null}
        onClose={() => { setOpenApplicationId(null); setDossier(null); }}
        dossier={dossier}
        vocabulary={vocabulary}
        loading={dossierLoading}
        error={dossierError}
        saving={saving}
        onDecide={onDecide}
        onDraftOffer={onDraftOffer}
        onSendOffer={onSendOffer}
        onRespondOffer={onRespondOffer}
      />
    </PageContainer>
  );
}
