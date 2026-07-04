'use client';

/**
 * PsychometricEditor — the Pro persona-personality editor.
 *
 * Three ways to define an agent's trait vector, all writing the same
 * {@link PsychometricProfile}:
 *   • Sliders      — one slider per dimension across the full framework suite
 *   • Questionnaire — a Likert intake, scored server-side into the vector
 *   • Import        — paste a human's test results (JSON) to seed the vector
 *
 * The component decides its own visibility: when the tenant is not entitled it
 * renders a locked upsell instead of the editor (shared-component gating, so the
 * persona modal never needs to know the plan).
 */
import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { psychometric as psychometricApi } from '@/lib/builderforceApi';
import { usePsychometricCatalog } from '@/lib/usePsychometricCatalog';
import {
  NEUTRAL_SCORE,
  profileHasSignal,
  type PsychometricProfile,
} from '@/lib/psychometric';

type Tab = 'sliders' | 'questionnaire' | 'import';

/** Plan slug → display name (brand proper nouns; not translated). */
const PLAN_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', teams: 'Teams' };

interface Props {
  value?: PsychometricProfile;
  onChange: (profile: PsychometricProfile | undefined) => void;
  /**
   * Bypass the Pro entitlement gate. Personality is a Pro feature for agents /
   * personas, but it is UNIVERSAL for human users — every person can take the test
   * — so the user's own profile passes this to always show the editor.
   */
  forceUnlocked?: boolean;
}

export default function PsychometricEditor({ value, onChange, forceUnlocked = false }: Props) {
  const t = useTranslations('psychometricEditor');
  // Shared, session-cached catalog (fetched once across the editor + summary).
  const { catalog, loading, error } = usePsychometricCatalog();
  const entitled = forceUnlocked || (catalog?.entitled ?? false);
  const planLabel = PLAN_LABEL[catalog?.requiredPlan ?? 'pro'] ?? PLAN_LABEL.pro;
  const frameworks = catalog?.frameworks ?? [];
  const questions = catalog?.questions ?? [];
  const enneagram = catalog?.enneagram ?? [];

  const [tab, setTab] = useState<Tab>('sliders');
  const [vector, setVector] = useState<Record<string, number>>(value?.vector ?? {});
  const [enneagramType, setEnneagramType] = useState<number | undefined>(value?.enneagramType);
  const [mbti, setMbti] = useState(value?.mbti ?? '');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const emit = useCallback(
    (next: { vector?: Record<string, number>; enneagramType?: number; mbti?: string; source?: PsychometricProfile['source'] }) => {
      const merged: PsychometricProfile = {
        vector: next.vector ?? vector,
        enneagramType: 'enneagramType' in next ? next.enneagramType : enneagramType,
        mbti: ('mbti' in next ? next.mbti : mbti) || undefined,
        source: next.source ?? value?.source ?? 'sliders',
      };
      onChange(profileHasSignal(merged) ? merged : undefined);
    },
    [vector, enneagramType, mbti, value?.source, onChange],
  );

  const setDimension = (id: string, score: number) => {
    const next = { ...vector, [id]: score };
    setVector(next);
    emit({ vector: next, source: 'sliders' });
  };

  const applyQuestionnaire = async () => {
    setBusy(true);
    setNotice('');
    try {
      const { vector: scored } = await psychometricApi.score(answers);
      const next = { ...vector, ...scored };
      setVector(next);
      emit({ vector: next, source: 'questionnaire' });
      setTab('sliders');
      setNotice(t('noticeScored'));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t('noticeScoreFailed'));
    } finally {
      setBusy(false);
    }
  };

  const applyImport = async () => {
    setBusy(true);
    setNotice('');
    try {
      const parsed = JSON.parse(importText) as Record<string, number>;
      const { vector: imported } = await psychometricApi.import(parsed);
      if (Object.keys(imported).length === 0) {
        setNotice(t('noticeNoDimensions'));
      } else {
        const next = { ...vector, ...imported };
        setVector(next);
        emit({ vector: next, source: 'imported' });
        setTab('sliders');
        setNotice(t('noticeImported', { count: Object.keys(imported).length }));
      }
    } catch {
      setNotice(t('noticeParseError'));
    } finally {
      setBusy(false);
    }
  };

  const signalCount = useMemo(
    () => Object.values(vector).filter((v) => v !== NEUTRAL_SCORE).length + (enneagramType ? 1 : 0) + (mbti ? 1 : 0),
    [vector, enneagramType, mbti],
  );

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('loading')}</div>;
  if (error) return <div style={{ color: 'var(--error-text)', fontSize: 13 }}>{error}</div>;

  if (!entitled) {
    return (
      <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 16, background: 'var(--surface-2)' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>🔒 {t('lockedTitle', { plan: planLabel })}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          {t('lockedBody', { plan: planLabel })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{t('heading')}</div>
        <span className="badge badge-gray">{t('traitsSet', { count: signalCount })}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['sliders', 'questionnaire', 'import'] as Tab[]).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={`btn btn-sm ${tab === tabKey ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab(tabKey)}
            >
              {tabKey === 'sliders' ? t('tabSliders') : tabKey === 'questionnaire' ? t('tabQuestionnaire') : t('tabImport')}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{notice}</div>
      )}

      {tab === 'sliders' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 360, overflowY: 'auto' }}>
          {frameworks.map((fw) => (
            <div key={fw.id}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{fw.name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{fw.summary}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {fw.dimensions.map((dim) => {
                  const score = vector[dim.id] ?? NEUTRAL_SCORE;
                  return (
                    <div key={dim.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                        <span title={dim.description} style={{ fontWeight: 600 }}>{dim.name}</span>
                        <span style={{ color: 'var(--muted)' }}>{score}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={score}
                        onChange={(e) => setDimension(dim.id, Number(e.target.value))}
                        style={{ width: '100%' }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
                        <span>{dim.low}</span>
                        <span>{dim.high}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="label">{t('enneagramLabel')}</label>
              <Select
                className="input"
                value={enneagramType ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : undefined;
                  setEnneagramType(val);
                  emit({ enneagramType: val });
                }}
              >
                <option value="">{t('none')}</option>
                {enneagram.map((en) => (
                  <option key={en.type} value={en.type}>
                    {en.type} · {en.name} — {en.motivation}
                  </option>
                ))}
              </Select>
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label className="label">{t('mbtiLabel')}</label>
              <input
                className="input"
                maxLength={4}
                placeholder={t('mbtiPlaceholder')}
                value={mbti}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  setMbti(v);
                  emit({ mbti: v });
                }}
              />
            </div>
          </div>
        </div>
      )}

      {tab === 'questionnaire' && (
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 320, overflowY: 'auto' }}>
            {questions.map((qn) => (
              <div key={qn.id}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>{qn.text}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>{t('disagree')}</span>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
                      <input
                        type="radio"
                        name={`q-${qn.id}`}
                        checked={answers[qn.id] === n}
                        onChange={() => setAnswers((a) => ({ ...a, [qn.id]: n }))}
                      />
                      {n}
                    </label>
                  ))}
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>{t('agree')}</span>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ marginTop: 12 }}
            disabled={busy || Object.keys(answers).length === 0}
            onClick={applyQuestionnaire}
          >
            {busy ? t('scoring') : t('applyScores')}
          </button>
        </div>
      )}

      {tab === 'import' && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            {t('importHelp')}
          </div>
          <textarea
            className="input"
            rows={6}
            placeholder={'{\n  "hexaco.conscientiousness": 80,\n  "cognition.need_for_cognition": 90\n}'}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ marginTop: 10 }}
            disabled={busy || !importText.trim()}
            onClick={applyImport}
          >
            {busy ? t('importing') : t('importBtn')}
          </button>
        </div>
      )}
    </div>
  );
}
