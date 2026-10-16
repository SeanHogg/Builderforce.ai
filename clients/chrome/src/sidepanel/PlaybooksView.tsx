/**
 * PLAYBOOKS — "when I say X, do Y (on site Z)". Written here, kept in Chrome's synced
 * storage, and folded into every run's instructions (`playbooks/playbooks.ts`).
 */
import { useCallback, useState, type FormEvent } from 'react';
import { t } from '../i18n/t';
import { normalizePlaybook, STEPS_MAX, TRIGGER_MAX, type Playbook } from '../playbooks/playbooks';
import { useLoaded, useServices } from './hooks';

const EMPTY = { id: '', trigger: '', steps: '', site: '', enabled: true };

export function PlaybooksView() {
  const services = useServices();
  const subscribe = useCallback((reload: () => void) => services.playbooks.subscribe(reload), [services]);
  const [playbooks, reload] = useLoaded<Playbook[]>(() => services.playbooks.list(), [], [], subscribe);
  const [draft, setDraft] = useState(EMPTY);
  const [invalid, setInvalid] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const playbook = normalizePlaybook({ ...draft, id: draft.id || crypto.randomUUID() }, new Date());
    if (!playbook) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    await services.playbooks.save(playbook);
    setDraft(EMPTY);
    reload();
  };

  return (
    <section className="rovr-stack">
      <p className="rovr-muted">{t('playbooksIntro')}</p>
      <form className="rovr-stack rovr-card" onSubmit={(e) => void save(e)}>
        <label className="rovr-field">
          <span>{t('playbookTrigger')}</span>
          <input
            className="rovr-input"
            value={draft.trigger}
            maxLength={TRIGGER_MAX}
            placeholder={t('playbookTriggerPlaceholder')}
            onChange={(e) => setDraft({ ...draft, trigger: e.target.value })}
          />
        </label>
        <label className="rovr-field">
          <span>{t('playbookSteps')}</span>
          <textarea
            className="rovr-input"
            rows={4}
            value={draft.steps}
            maxLength={STEPS_MAX}
            placeholder={t('playbookStepsPlaceholder')}
            onChange={(e) => setDraft({ ...draft, steps: e.target.value })}
          />
        </label>
        <label className="rovr-field">
          <span>{t('playbookSite')}</span>
          <input
            className="rovr-input"
            value={draft.site}
            placeholder={t('playbookSitePlaceholder')}
            onChange={(e) => setDraft({ ...draft, site: e.target.value })}
          />
        </label>
        {invalid && (
          <p className="rovr-error" role="alert">
            {t('playbookInvalid')}
          </p>
        )}
        <div className="rovr-row">
          <button type="submit" className="rovr-btn rovr-btn--primary">
            {draft.id ? t('playbookUpdate') : t('playbookSave')}
          </button>
          {draft.id && (
            <button type="button" className="rovr-btn" onClick={() => setDraft(EMPTY)}>
              {t('cancel')}
            </button>
          )}
        </div>
      </form>

      {playbooks.length === 0 ? (
        <p className="rovr-empty">{t('playbooksEmpty')}</p>
      ) : (
        <ul className="rovr-list">
          {playbooks.map((p) => (
            <li key={p.id} className="rovr-card">
              <p className="rovr-card__title">{p.trigger}</p>
              {p.site && <p className="rovr-muted">{p.site}</p>}
              <p className="rovr-pre">{p.steps}</p>
              <div className="rovr-row">
                <label className="rovr-check">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={(e) => void services.playbooks.save({ ...p, enabled: e.target.checked }).then(reload)}
                  />
                  {t('playbookEnabled')}
                </label>
                <button type="button" className="rovr-btn" onClick={() => setDraft({ id: p.id, trigger: p.trigger, steps: p.steps, site: p.site, enabled: p.enabled })}>
                  {t('edit')}
                </button>
                <button type="button" className="rovr-btn" onClick={() => void services.playbooks.remove(p.id).then(reload)}>
                  {t('delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
