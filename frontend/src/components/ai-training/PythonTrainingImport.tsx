/**
 * Load the adapter a project's Python `training` service saved (PRD 31 §W9 phase 7) as the
 * panel's completed artifact — then the panel's existing publish / test / benchmark path
 * takes it exactly as it takes an adapter trained here. The training services are the
 * blueprint's (`builderforce.json`); the base is the save's own, else the warm-start
 * checkpoint and tokenizer chosen in the panel (parsed only when the save has none).
 * A local-only canvas (no server project) has no blueprint, so nothing renders there.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { HuggingFaceTokenizerSpec } from '@seanhogg/builderforce-memory-engine';
import { Select } from '@/components/Select';
import { fetchProjectBlueprint } from '@/lib/appBlueprintApi';
import type { BrowserLoRAArtifact } from '@/lib/training/protocol';
import {
  baseFromCheckpoint,
  loadTrainingServiceArtifact,
  TrainingAdapterError,
  trainingServiceIds,
} from '@/lib/training/trainingServiceAdapter';

interface PythonTrainingImportProps {
  projectId: string | number;
  /** The panel's warm-start base, used when the save carries none. */
  baseCheckpoint?: ArrayBuffer;
  tokenizerSpec?: HuggingFaceTokenizerSpec;
  baseModelId: string;
  onArtifact: (artifact: BrowserLoRAArtifact, serviceId: string) => void;
}

/** The blueprint's project id (the runtime keys a save by it) and its training services. */
interface TrainingServices {
  projectId: string;
  ids: string[];
}

const SERVER_PROJECT = /^\d+$/;

export function PythonTrainingImport({ projectId, baseCheckpoint, tokenizerSpec, baseModelId, onArtifact }: PythonTrainingImportProps) {
  const t = useTranslations('aiTraining');
  const [services, setServices] = useState<TrainingServices | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const serverProject = SERVER_PROJECT.test(String(projectId));

  useEffect(() => {
    if (!serverProject) return undefined;
    let live = true;
    fetchProjectBlueprint(projectId)
      .then((blueprint) => {
        if (!live) return;
        const ids = trainingServiceIds(blueprint);
        setServices({ projectId: String(blueprint?.projectId ?? projectId), ids });
        setSelected(ids[0] ?? '');
      })
      .catch(() => { if (live) { setServices({ projectId: String(projectId), ids: [] }); setMessage({ ok: false, text: t('pythonTrainingBlueprintFailed') }); } });
    return () => { live = false; };
  }, [projectId, serverProject, t]);

  const load = async () => {
    if (!selected || !services) return;
    setBusy(true);
    setMessage(null);
    try {
      const base = baseCheckpoint && tokenizerSpec ? () => baseFromCheckpoint(new Uint8Array(baseCheckpoint), tokenizerSpec, baseModelId) : undefined;
      const artifact = await loadTrainingServiceArtifact({ projectId: services.projectId, serviceId: selected }, base);
      onArtifact(artifact, selected);
      setMessage({ ok: true, text: t('pythonTrainingLoaded', { service: selected }) });
    } catch (error) {
      const text = error instanceof TrainingAdapterError ? t(`pythonTrainingIssue.${error.issue}`, { service: selected }) : t('pythonTrainingFailed');
      setMessage({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };

  if (!serverProject || services === null) return null;
  return (
    <div className="rounded border border-gray-700 bg-gray-900 p-2 space-y-2">
      <div className="text-xs font-semibold text-gray-200">{t('pythonTrainingTitle')}</div>
      <p className="text-xs text-gray-400">{t('pythonTrainingHint')}</p>
      {services.ids.length === 0 ? (
        <p className="text-xs text-gray-500">{t('pythonTrainingNone')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            aria-label={t('pythonTrainingServiceAria')}
            className="min-w-0 flex-1 bg-gray-800 text-gray-100 text-xs rounded px-2 py-1.5 border border-gray-700"
          >
            {services.ids.map((id) => <option key={id} value={id}>{id}</option>)}
          </Select>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy || !selected}
            className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs font-semibold"
          >
            {busy ? t('pythonTrainingLoading') : t('pythonTrainingLoad')}
          </button>
        </div>
      )}
      {message && <div role="status" className={`text-xs ${message.ok ? 'text-emerald-300' : 'text-amber-400'}`}>{message.text}</div>}
    </div>
  );
}
