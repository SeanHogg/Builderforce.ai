/**
 * Settings: the Builderforce account (device sign-in), the sites Rovr may use (Chrome's
 * own permission grants), the models on this device, where tasks are filed, and whether
 * error reports may leave the browser.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { localRuntime, type LocalRuntimeProbe } from '@builderforce/local-inference';
import { completeDeviceSignIn, DeviceAuthError, startDeviceSignIn, type DeviceAuthFailure } from '@builderforce/device-auth';
import { DEVICE_CLIENT } from '../config';
import { SYNAPSE_DEFAULT_URL } from '../inference/localRuntimes';
import { originOf } from '../tools/safety';
import { t, type MessageKey } from '../i18n/t';
import { useLoaded, useServices, useSignedIn } from './hooks';
import { ModelPickerSection } from './ModelPickerSection';

const FAILURE_KEY: Record<DeviceAuthFailure, MessageKey> = {
  unavailable: 'signInUnavailable',
  denied: 'signInDenied',
  expired: 'signInExpired',
  cancelled: 'signInCancelled',
  failed: 'signInFailed',
};

export function SettingsView() {
  return (
    <section className="rovr-stack">
      <AccountSection />
      <SitesSection />
      <ModelPickerSection />
      <LocalModelsSection />
      <TaskProjectSection />
      <ReportingSection />
    </section>
  );
}

function AccountSection() {
  const services = useServices();
  const signedIn = useSignedIn();
  const [code, setCode] = useState<string | null>(null);
  const [failure, setFailure] = useState<DeviceAuthFailure | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const signIn = async () => {
    setFailure(null);
    const controller = new AbortController();
    abort.current = controller;
    const deps = {
      baseUrl: services.baseUrl,
      fetch: (input: string, init?: RequestInit) => fetch(input, init),
      openTab: async (url: string) => {
        await chrome.tabs.create({ url });
      },
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      now: Date.now,
      client: DEVICE_CLIENT,
    };
    try {
      const start = await startDeviceSignIn(deps);
      setCode(start.userCode);
      const result = await completeDeviceSignIn(deps, start, controller.signal);
      await services.session.signIn(result);
      // Signing in moves an undecided person onto Hybrid; apply it before the exchange.
      await services.policy.refresh();
      await services.session.jwt(); // learn the workspace, so the sync outboxes can send
    } catch (e) {
      const reason = e instanceof DeviceAuthError ? e.reason : 'failed';
      if (reason !== 'cancelled') {
        setFailure(reason);
        services.reportError(e, 'auth.deviceSignIn');
      }
    } finally {
      setCode(null);
      abort.current = null;
    }
  };

  return (
    <div className="rovr-card rovr-stack">
      <h2 className="rovr-h2">{t('accountHeading')}</h2>
      <p className="rovr-muted">{signedIn ? t('signedIn') : t('signedOutHint')}</p>
      {code && (
        <p aria-live="polite">
          {t('signInCode', code)} <span className="rovr-muted">{t('signInWaiting')}</span>
        </p>
      )}
      {failure && (
        <p className="rovr-error" role="alert">
          {t(FAILURE_KEY[failure])}
        </p>
      )}
      <div className="rovr-row">
        {signedIn ? (
          <button type="button" className="bf-btn" onClick={() => void services.session.signOut()}>
            {t('signOut')}
          </button>
        ) : code ? (
          <button type="button" className="bf-btn" onClick={() => abort.current?.abort()}>
            {t('cancel')}
          </button>
        ) : (
          <button type="button" className="bf-btn bf-btn--primary" onClick={() => void signIn()}>
            {t('signIn')}
          </button>
        )}
      </div>
    </div>
  );
}

function SitesSection() {
  const services = useServices();
  const subscribe = useCallback((reload: () => void) => services.sites.subscribe(reload), [services]);
  const [sites] = useLoaded<string[]>(() => services.sites.list(), [], [], subscribe);
  const tab = services.working.current();
  const here = originOf(tab?.url);
  return (
    <div className="rovr-card rovr-stack">
      <h2 className="rovr-h2">{t('sitesHeading')}</h2>
      <p className="rovr-muted">{t('sitesIntro')}</p>
      {here && !sites.includes(here) && (
        <button type="button" className="bf-btn" onClick={() => void services.sites.request(here)}>
          {t('allowSite', here)}
        </button>
      )}
      {sites.length === 0 ? (
        <p className="rovr-empty">{t('sitesEmpty')}</p>
      ) : (
        <ul className="rovr-list">
          {sites.map((site) => (
            <li key={site} className="rovr-row rovr-row--spread">
              <span className="rovr-ellipsis">{site}</span>
              <button type="button" className="bf-btn" onClick={() => void services.sites.remove(site)} aria-label={t('removeSiteLabel', site)}>
                {t('remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LocalModelsSection() {
  const services = useServices();
  const [probes, setProbes] = useState<LocalRuntimeProbe[] | null>(null);
  const [synapseUrl, setSynapseUrl] = useState('');
  const refresh = useCallback(() => {
    setProbes(null);
    void services.probeLocal().then(setProbes, () => setProbes([]));
  }, [services]);
  useEffect(() => {
    void services.settings.synapseUrl().then((u) => setSynapseUrl(u ?? ''));
    refresh();
  }, [services, refresh]);

  return (
    <div className="rovr-card rovr-stack">
      <h2 className="rovr-h2">{t('localHeading')}</h2>
      <p className="rovr-muted">{t('localIntro')}</p>
      {probes === null ? (
        <p className="rovr-muted">{t('localProbing')}</p>
      ) : (
        <ul className="rovr-list">
          {probes.map((p) => (
            <li key={p.provider} className="rovr-row rovr-row--spread">
              {/* Runtime brands are not translated ("Ollama" is "Ollama" everywhere). */}
              <span>{localRuntime(p.provider).label}</span>
              <span className={`bf-chip bf-chip--${p.reachable && p.models.length ? 'ok' : 'off'}`}>
                {p.reachable ? t('localModels', p.models.length) : t('localNotRunning')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <label className="rovr-field">
        <span>{t('synapseAddress')}</span>
        <input
          className="bf-input"
          value={synapseUrl}
          placeholder={SYNAPSE_DEFAULT_URL}
          onChange={(e) => setSynapseUrl(e.target.value)}
          onBlur={() => void services.settings.setSynapseUrl(synapseUrl || null).then(refresh)}
        />
      </label>
      <button type="button" className="bf-btn" onClick={refresh}>
        {t('refresh')}
      </button>
    </div>
  );
}

function TaskProjectSection() {
  const services = useServices();
  const signedIn = useSignedIn();
  const [projects] = useLoaded<Array<{ id: number; name: string }>>(
    () =>
      signedIn
        ? services.api.request<{ projects?: Array<{ id: number; name: string }> }>('/api/projects').then((r) => r.projects ?? [], () => [])
        : Promise.resolve([]),
    [],
    [signedIn],
  );
  const [projectId, setProjectId] = useState<number | null>(null);
  useEffect(() => {
    void services.settings.taskProjectId().then(setProjectId);
  }, [services]);

  return (
    <div className="rovr-card rovr-stack">
      <h2 className="rovr-h2">{t('tasksHeading')}</h2>
      <label className="rovr-field">
        <span>{t('taskProjectLabel')}</span>
        <select
          className="bf-select"
          value={projectId ?? ''}
          disabled={!signedIn}
          onChange={(e) => {
            const next = e.target.value ? Number(e.target.value) : null;
            setProjectId(next);
            void services.settings.setTaskProjectId(next);
          }}
        >
          <option value="">{t('taskProjectNone')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ReportingSection() {
  const services = useServices();
  const [on, setOn] = useState(false);
  useEffect(() => {
    void services.settings.reportErrors().then(setOn);
  }, [services]);
  return (
    <div className="rovr-card">
      <label className="rovr-check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            void services.settings.setReportErrors(e.target.checked);
          }}
        />
        {t('reportErrors')}
      </label>
      <p className="rovr-muted">{t('reportErrorsHint')}</p>
    </div>
  );
}
