-- 1060 — `hired-default` stops being a vendor brand frozen into user data.
--
-- WHY
-- ------------------------------------------------------------------------------
-- The first-party résumé design shipped as `id: 'hired-default'`, and a revision
-- PERSISTS the id it was authored with (`resumeFamily.revisions[].templateId`,
-- plus the family's `defaultTemplateId`). hired.video is being deprecated
-- outright, so the name is stale the moment the redirect lands — and it is the
-- one piece of that vocabulary a user can actually see, in the template picker
-- and on every exported PDF's design label.
--
-- The registry is renamed to `standard` in the same pass
-- (`packages/creation-canvas-contract/src/resume.ts`,
--  `frontend/src/lib/canvasResume.ts`, `template_standard` in all five
--  catalogs). This rewrites what is already stored, because the family reader
-- DROPS a revision whose `templateId` it does not recognise — and dropping the
-- ORIGINAL revision discards the whole résumé. Leaving the rows to be healed
-- lazily by the read-boundary alias would work, but it gets strictly more
-- expensive per stored résumé and leaves the stale name in every backup.
--
-- WHY A TEXT REPLACE AND NOT jsonb_set
-- ------------------------------------------------------------------------------
-- The id occurs at an unbounded array index (`revisions[n].templateId`), so a
-- targeted `jsonb_set` would need a lateral unnest-and-reassemble per row for a
-- value that is a single distinctive literal. Scoped to `kind = 'resume'` rows
-- that actually contain it, a quoted-literal replace is exact: `"hired-default"`
-- is not a substring of any other template id, and no other field in a résumé
-- object carries that value.
--
-- The read boundary ALSO normalises (`normalizeResumeTemplateId`), because a
-- guest board keeps its family in browser storage where no migration reaches.

UPDATE creation_session_objects
SET content = replace(content::text, '"hired-default"', '"standard"')::jsonb,
    updated_at = NOW()
WHERE kind = 'resume'
  AND content IS NOT NULL
  AND content::text LIKE '%"hired-default"%';

UPDATE creation_session_objects
SET canvas_data = replace(canvas_data::text, '"hired-default"', '"standard"')::jsonb,
    updated_at = NOW()
WHERE kind = 'resume'
  AND canvas_data::text LIKE '%"hired-default"%';
