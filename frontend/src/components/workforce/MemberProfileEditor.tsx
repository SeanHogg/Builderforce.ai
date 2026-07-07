'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { membersApi, type MemberKind, type MemberProfile } from '@/lib/builderforceApi';
import { MemberTimeChart } from './MemberTimeChart';

/**
 * Capability & availability profile editor for one workforce member (human OR
 * agent). These are the inputs the AI sprint planner consumes to decide
 * who/what/when (see /api/members + assigneeRecommender). Rendered as a modal
 * from the Performance tab's scorecard rows.
 */

const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' };
const field: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary, var(--text-secondary))', fontSize: 13,
};
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };

const AVAILABILITY: MemberProfile['availabilityStatus'][] = ['available', 'busy', 'focus', 'on_call', 'ooo'];
const EXPERIENCE: NonNullable<MemberProfile['experienceLevel']>[] = ['junior', 'mid', 'senior', 'staff', 'principal'];
const DISCIPLINES: NonNullable<MemberProfile['discipline']>[] = ['engineering', 'product', 'design', 'qa', 'devops', 'data', 'other'];

/** [{tag}] | string[] → "a, b, c" for the tag inputs, and back. */
function tagsToText(v: unknown): string {
  if (!Array.isArray(v)) return '';
  return v.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && 'tag' in x ? String((x as { tag: unknown }).tag) : '')).filter(Boolean).join(', ');
}
function textToTags(s: string): { tag: string }[] {
  return s.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => ({ tag }));
}
function textToStrings(s: string): string[] {
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}

export function MemberProfileEditor({ kind, refId, name, onClose, onSaved }: {
  kind: MemberKind; refId: string; name: string; onClose: () => void; onSaved?: () => void;
}) {
  const t = useTranslations('memberProfile');
  const tw = useTranslations('workforce');
  const tc = useTranslations('common');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState<Partial<MemberProfile>>({ availabilityStatus: 'available', rampFactor: 1 });
  const [skillsText, setSkillsText] = useState('');
  const [focusText, setFocusText] = useState('');
  const [taskTypesText, setTaskTypesText] = useState('');
  const [calMsg, setCalMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    membersApi.getProfile(kind, refId)
      .then((r) => {
        if (r.profile) {
          setP(r.profile);
          setSkillsText(tagsToText(r.profile.skills));
          setFocusText(tagsToText(r.profile.focusAreas));
          setTaskTypesText(tagsToText(r.profile.preferredTaskTypes));
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [kind, refId]);

  const set = <K extends keyof MemberProfile>(k: K, v: MemberProfile[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

  const syncCalendar = async () => {
    setSyncing(true); setCalMsg(null);
    try {
      const r = await membersApi.calendarSync(kind, refId);
      if (r.ok) {
        const until = r.availabilityUntil ? t('syncedUntil', { time: new Date(r.availabilityUntil).toLocaleString() }) : '';
        setCalMsg(t('syncedMsg', { status: r.availabilityStatus, until, count: r.ptoCount ?? 0 }));
        const fresh = await membersApi.getProfile(kind, refId);
        if (fresh.profile) setP(fresh.profile);
      } else {
        setCalMsg(r.message ?? t('syncFailed'));
      }
    } catch (e) {
      setCalMsg((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await membersApi.putProfile(kind, refId, {
        ...p,
        skills: textToTags(skillsText),
        focusAreas: textToStrings(focusText),
        preferredTaskTypes: textToStrings(taskTypesText),
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOutPanel
      open
      onClose={onClose}
      title={
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{t('subtitle', { kind: kind.replace('_', ' ') })}</div>
        </div>
      }
      width="min(560px, 96vw)"
    >
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Activity chart — real logged time (migration 0245). */}
        <MemberTimeChart kind={kind} refId={refId} />

        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{tc('loading')}</div>
        ) : (
          <>
            {kind === 'human' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
                <button onClick={syncCalendar} disabled={syncing} style={{ ...field, width: 'auto', cursor: 'pointer' }}>
                  {syncing ? t('syncing') : t('syncFromGoogleCalendar')}
                </button>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{calMsg ?? t('calendarHint')}</span>
              </div>
            )}
            <div style={row}>
              <div>
                <label style={label}>{t('availability')}</label>
                <Select style={field} value={p.availabilityStatus ?? 'available'} onChange={(e) => set('availabilityStatus', e.target.value as MemberProfile['availabilityStatus'])}>
                  {AVAILABILITY.map((a) => <option key={a} value={a}>{t(`availabilityOptions.${a}`)}</option>)}
                </Select>
              </div>
              <div>
                <label style={label}>{t('experience')}</label>
                <Select style={field} value={p.experienceLevel ?? ''} onChange={(e) => set('experienceLevel', (e.target.value || null) as MemberProfile['experienceLevel'])}>
                  <option value="">—</option>
                  {EXPERIENCE.map((x) => <option key={x} value={x}>{t(`experienceOptions.${x}`)}</option>)}
                </Select>
              </div>
            </div>

            <div style={row}>
              <div>
                <label style={label}>{tw('discipline')}</label>
                <Select style={field} value={p.discipline ?? ''} onChange={(e) => set('discipline', (e.target.value || null) as MemberProfile['discipline'])}>
                  <option value="">—</option>
                  {DISCIPLINES.map((x) => <option key={x} value={x}>{tw(`disciplineOptions.${x}`)}</option>)}
                </Select>
              </div>
              <div />
            </div>

            <div style={row}>
              <div>
                <label style={label}>{t('timezone')}</label>
                <input style={field} placeholder="America/New_York" value={p.timezone ?? ''} onChange={(e) => set('timezone', e.target.value || null)} />
              </div>
              <div>
                <label style={label}>{t('maxConcurrentWip')}</label>
                <input style={field} type="number" min={0} value={p.maxConcurrentWip ?? ''} onChange={(e) => set('maxConcurrentWip', num(e.target.value))} />
              </div>
            </div>

            <div style={row}>
              <div>
                <label style={label}>{t('weeklyCapacity')}</label>
                <input style={field} type="number" min={0} value={p.weeklyCapacityHours ?? ''} onChange={(e) => set('weeklyCapacityHours', num(e.target.value))} />
              </div>
              <div>
                <label style={label}>{t('dailyCapacity')}</label>
                <input style={field} type="number" min={0} value={p.dailyCapacityPoints ?? ''} onChange={(e) => set('dailyCapacityPoints', num(e.target.value))} />
              </div>
            </div>

            <div style={row}>
              <div>
                <label style={label}>{t('responseSla')}</label>
                <input style={field} type="number" min={0} value={p.responseSlaHours ?? ''} onChange={(e) => set('responseSlaHours', num(e.target.value))} />
              </div>
              <div>
                <label style={label}>{t('rampFactor')}</label>
                <input style={field} type="number" min={0} max={1} step={0.05} value={p.rampFactor ?? 1} onChange={(e) => set('rampFactor', num(e.target.value))} />
              </div>
            </div>

            <div>
              <label style={label}>{t('skills')}</label>
              <input style={field} placeholder="react, typescript, postgres" value={skillsText} onChange={(e) => setSkillsText(e.target.value)} />
            </div>
            <div style={row}>
              <div>
                <label style={label}>{t('focusAreas')}</label>
                <input style={field} placeholder="frontend, billing" value={focusText} onChange={(e) => setFocusText(e.target.value)} />
              </div>
              <div>
                <label style={label}>{t('preferredTaskTypes')}</label>
                <input style={field} placeholder="bugfix, feature" value={taskTypesText} onChange={(e) => setTaskTypesText(e.target.value)} />
              </div>
            </div>

            {error && <div style={{ color: 'var(--danger, #e5484d)', fontSize: 12 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onClose} style={{ ...field, width: 'auto', cursor: 'pointer' }}>{tc('cancel')}</button>
              <button onClick={save} disabled={saving} style={{ ...field, width: 'auto', cursor: 'pointer', background: 'var(--accent, #6366f1)', color: '#fff', border: 'none', opacity: saving ? 0.6 : 1 }}>
                {saving ? tc('saving') : t('saveProfile')}
              </button>
            </div>
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}
