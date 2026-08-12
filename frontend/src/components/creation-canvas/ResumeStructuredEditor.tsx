'use client';

import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import type { CanvasResumeDocument, CanvasResumeEducation, CanvasResumeSkill, CanvasResumeWork } from '@/lib/canvasResume';

type SectionName = 'work' | 'education' | 'skills' | 'volunteer' | 'languages' | 'projects' | 'awards' | 'certificates' | 'publications' | 'interests' | 'references';

const ADDITIONAL_SECTIONS = [
  { id: 'volunteer', titleKey: 'volunteer', addKey: 'addVolunteer', entryKey: 'volunteerEntry', titleField: 'organization', fields: [['organization', false], ['position', false], ['url', false], ['startDate', false], ['endDate', false], ['summary', true], ['highlights', true]] },
  { id: 'languages', titleKey: 'languages', addKey: 'addLanguage', entryKey: 'languageEntry', titleField: 'language', fields: [['language', false], ['fluency', false]] },
  { id: 'projects', titleKey: 'projects', addKey: 'addProject', entryKey: 'projectEntry', titleField: 'name', fields: [['name', false], ['entity', false], ['type', false], ['url', false], ['startDate', false], ['endDate', false], ['description', true], ['roles', true], ['keywords', true], ['highlights', true]] },
  { id: 'awards', titleKey: 'awards', addKey: 'addAward', entryKey: 'awardEntry', titleField: 'title', fields: [['title', false], ['awarder', false], ['date', false], ['summary', true]] },
  { id: 'certificates', titleKey: 'certificates', addKey: 'addCertificate', entryKey: 'certificateEntry', titleField: 'name', fields: [['name', false], ['issuer', false], ['date', false], ['url', false]] },
  { id: 'publications', titleKey: 'publications', addKey: 'addPublication', entryKey: 'publicationEntry', titleField: 'name', fields: [['name', false], ['publisher', false], ['releaseDate', false], ['url', false], ['summary', true]] },
  { id: 'interests', titleKey: 'interests', addKey: 'addInterest', entryKey: 'interestEntry', titleField: 'name', fields: [['name', false], ['keywords', true]] },
  { id: 'references', titleKey: 'references', addKey: 'addReference', entryKey: 'referenceEntry', titleField: 'name', fields: [['name', false], ['reference', true]] },
] as const satisfies ReadonlyArray<{
  id: SectionName; titleKey: string; addKey: string; entryKey: string; titleField: string;
  fields: ReadonlyArray<readonly [string, boolean]>;
}>;

const ARRAY_FIELDS = new Set(['highlights', 'keywords', 'roles']);

const values = (value: string): string[] => value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);

export function ResumeStructuredEditor({ document, onChange }: { document: CanvasResumeDocument; onChange: (document: CanvasResumeDocument) => void }) {
  const t = useTranslations('creationCanvas.resumeEditor');
  const translate = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const basics = document.basics ?? {};
  const updateBasics = (field: string, value: string) => onChange({ ...document, basics: { ...basics, [field]: value } });
  const updateLocation = (field: string, value: string) => onChange({ ...document, basics: { ...basics, location: { ...(basics.location ?? {}), [field]: value } } });
  const replace = <T extends Record<string, unknown>>(section: SectionName, index: number, row: T) => {
    const rows = [...((document[section] as T[] | undefined) ?? [])];
    rows[index] = row;
    onChange({ ...document, [section]: rows });
  };
  const remove = (section: SectionName, index: number) => onChange({ ...document, [section]: ((document[section] as unknown[] | undefined) ?? []).filter((_, rowIndex) => rowIndex !== index) });
  const move = (section: SectionName, index: number, delta: number) => {
    const rows = [...((document[section] as unknown[] | undefined) ?? [])];
    const destination = index + delta;
    if (destination < 0 || destination >= rows.length) return;
    [rows[index], rows[destination]] = [rows[destination], rows[index]];
    onChange({ ...document, [section]: rows });
  };
  const add = (section: SectionName) => {
    const row = section === 'work' ? { id: crypto.randomUUID(), highlights: [] }
      : section === 'education' ? { id: crypto.randomUUID(), courses: [] }
        : section === 'skills' ? { id: crypto.randomUUID(), keywords: [] }
          : { id: crypto.randomUUID() };
    onChange({ ...document, [section]: [...((document[section] as unknown[] | undefined) ?? []), row] });
  };
  const actions = (section: SectionName, index: number, length: number) => <div className={styles.resumeEntryActions}>
    <button type="button" disabled={index === 0} aria-label={t('moveUp')} onClick={() => move(section, index, -1)}>↑</button>
    <button type="button" disabled={index === length - 1} aria-label={t('moveDown')} onClick={() => move(section, index, 1)}>↓</button>
    <button type="button" aria-label={t('removeEntry')} onClick={() => remove(section, index)}>×</button>
  </div>;
  const field = (label: string, value: unknown, onValue: (value: string) => void, options: { wide?: boolean; multiline?: boolean; key?: string } = {}) => <label key={options.key} className={options.wide ? styles.resumeFieldWide : undefined}>
    <span>{label}</span>{options.multiline
      ? <textarea value={typeof value === 'string' ? value : ''} onChange={(event) => onValue(event.target.value)} />
      : <input value={typeof value === 'string' ? value : ''} onChange={(event) => onValue(event.target.value)} />}
  </label>;

  return <div className={styles.resumeStructuredEditor}>
    <details open><summary>{t('basics')}</summary><div className={styles.resumeFieldGrid}>
      {field(t('name'), basics.name, (value) => updateBasics('name', value))}
      {field(t('headline'), basics.label, (value) => updateBasics('label', value))}
      {field(t('email'), basics.email, (value) => updateBasics('email', value))}
      {field(t('phone'), basics.phone, (value) => updateBasics('phone', value))}
      {field(t('website'), basics.url, (value) => updateBasics('url', value))}
      {field(t('city'), basics.location?.city, (value) => updateLocation('city', value))}
      {field(t('region'), basics.location?.region, (value) => updateLocation('region', value))}
      {field(t('country'), basics.location?.countryCode, (value) => updateLocation('countryCode', value))}
      {field(t('summary'), basics.summary, (value) => updateBasics('summary', value), { wide: true, multiline: true })}
    </div></details>

    <details open><summary>{t('experience')}</summary>
      {(document.work ?? []).map((row: CanvasResumeWork, index, rows) => <fieldset key={row.id ?? index}><legend>{row.position || row.name || t('experienceEntry', { number: index + 1 })}</legend>{actions('work', index, rows.length)}<div className={styles.resumeFieldGrid}>
        {field(t('position'), row.position, (value) => replace('work', index, { ...row, position: value }))}
        {field(t('company'), row.name, (value) => replace('work', index, { ...row, name: value }))}
        {field(t('startDate'), row.startDate, (value) => replace('work', index, { ...row, startDate: value }))}
        {field(t('endDate'), row.endDate, (value) => replace('work', index, { ...row, endDate: value }))}
        {field(t('employmentType'), row.employmentType, (value) => replace('work', index, { ...row, employmentType: value }))}
        {field(t('workSetting'), row.locationType, (value) => replace('work', index, { ...row, locationType: value }))}
        {field(t('description'), row.summary, (value) => replace('work', index, { ...row, summary: value }), { wide: true, multiline: true })}
        {field(t('highlights'), (row.highlights ?? []).join('\n'), (value) => replace('work', index, { ...row, highlights: values(value) }), { wide: true, multiline: true })}
      </div></fieldset>)}
      <button type="button" className={styles.resumeAddEntry} onClick={() => add('work')}>{t('addExperience')}</button>
    </details>

    <details><summary>{t('education')}</summary>
      {(document.education ?? []).map((row: CanvasResumeEducation, index, rows) => <fieldset key={row.id ?? index}><legend>{row.institution || t('educationEntry', { number: index + 1 })}</legend>{actions('education', index, rows.length)}<div className={styles.resumeFieldGrid}>
        {field(t('institution'), row.institution, (value) => replace('education', index, { ...row, institution: value }))}
        {field(t('studyType'), row.studyType, (value) => replace('education', index, { ...row, studyType: value }))}
        {field(t('area'), row.area, (value) => replace('education', index, { ...row, area: value }))}
        {field(t('score'), row.score, (value) => replace('education', index, { ...row, score: value }))}
        {field(t('startDate'), row.startDate, (value) => replace('education', index, { ...row, startDate: value }))}
        {field(t('endDate'), row.endDate, (value) => replace('education', index, { ...row, endDate: value }))}
        {field(t('courses'), (row.courses ?? []).join('\n'), (value) => replace('education', index, { ...row, courses: values(value) }), { wide: true, multiline: true })}
      </div></fieldset>)}
      <button type="button" className={styles.resumeAddEntry} onClick={() => add('education')}>{t('addEducation')}</button>
    </details>

    <details><summary>{t('skills')}</summary>
      {(document.skills ?? []).map((row: CanvasResumeSkill, index, rows) => <fieldset key={row.id ?? index}><legend>{row.name || t('skillEntry', { number: index + 1 })}</legend>{actions('skills', index, rows.length)}<div className={styles.resumeFieldGrid}>
        {field(t('skillName'), row.name, (value) => replace('skills', index, { ...row, name: value }))}
        {field(t('level'), row.level, (value) => replace('skills', index, { ...row, level: value }))}
        {field(t('keywords'), (row.keywords ?? []).join(', '), (value) => replace('skills', index, { ...row, keywords: values(value) }), { wide: true })}
      </div></fieldset>)}
      <button type="button" className={styles.resumeAddEntry} onClick={() => add('skills')}>{t('addSkill')}</button>
    </details>

    {ADDITIONAL_SECTIONS.map((definition) => {
      const rows = (document[definition.id] as Array<Record<string, unknown>> | undefined) ?? [];
      return <details key={definition.id}><summary>{translate(definition.titleKey)}</summary>
        {rows.map((row, index) => <fieldset key={typeof row.id === 'string' ? row.id : index}>
          <legend>{typeof row[definition.titleField] === 'string' && row[definition.titleField] ? String(row[definition.titleField]) : translate(definition.entryKey, { number: index + 1 })}</legend>
          {actions(definition.id, index, rows.length)}
          <div className={styles.resumeFieldGrid}>{definition.fields.map(([key, multiline]) => field(
            translate(key),
            ARRAY_FIELDS.has(key) && Array.isArray(row[key]) ? (row[key] as string[]).join('\n') : row[key],
            (value) => replace(definition.id, index, { ...row, [key]: ARRAY_FIELDS.has(key) ? values(value) : value }),
            { wide: multiline, multiline, key },
          ))}</div>
        </fieldset>)}
        <button type="button" className={styles.resumeAddEntry} onClick={() => add(definition.id)}>{translate(definition.addKey)}</button>
      </details>;
    })}
  </div>;
}
