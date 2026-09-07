/*
 * No `'use client'` here on purpose. Imported only by `CanvasRoomSurface`, which
 * is itself reached through a `dynamic(..., { ssr: false })` import inside the
 * `CreationCanvas` client boundary — a directive here would mark an entry point
 * that does not exist.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOptionalProjectScope, useProjects } from '@/lib/ProjectScopeContext';
import { resolveStandupProject, stepStandupProject } from '@/lib/canvas/standupProject';
import type { RoomOccupant } from '@/lib/canvas/roomSeating';
import { CanvasBarGroup } from './CanvasBarGroup';
import { useRoomStandup, type RoomStandupParticipant } from './useRoomStandup';
import styles from './CanvasRoomSurface.module.css';

/**
 * WHAT THIS STANDUP IS ABOUT, and whether it is running.
 *
 * ── WHY IT IS A BAR CONTRIBUTION AND NOT CHROME IN THE ROOM ──────────────────
 * The canvas allows exactly one row of controls, and a surface publishes its own
 * into it (`canvasSurfaceActions`). Drawing a project picker and a Start button
 * inside the 3D stage would be the second toolbar that seam exists to prevent —
 * two rows that look alike, sit 40px apart, and disagree about which one you
 * press to do something.
 *
 * ── WHY THE CHOICE IS LOCAL TO THE MEETING ───────────────────────────────────
 * Picking a project here does NOT move the global scope switcher. The switcher
 * persists per tenant and reflects into the URL, so writing to it would mean
 * that walking the projects during a standup silently re-scoped Tasks, Planning
 * and Insights for everyone's next navigation — and left them wherever the
 * meeting happened to finish. The room seeds itself from the scope and then
 * keeps its own answer, which is also what makes "not associated" expressible:
 * a deliberate `null` here is a real choice, not the absence of one.
 *
 * ── WHY WALKING IS TWO BUTTONS AND NOT A MODE ────────────────────────────────
 * "Go through all the projects" is what a standup DOES, not a feature it needs.
 * Stepping the same picker is the whole mechanism, so there is no second state
 * to get out of sync, and the loop returns through the unassociated slot — which
 * is the moment a team stops talking about projects and talks about the company.
 */

export interface RoomStandupBarProps {
  /** The people in the room, seated by the surface. */
  members: readonly RoomOccupant[];
  /** The project this board itself names, when it names one. */
  boardProjectId?: number | null;
}

export function RoomStandupBar({ members, boardProjectId = null }: RoomStandupBarProps) {
  const t = useTranslations('creationCanvas.surface.room.standup');
  const projects = useProjects();
  const scope = useOptionalProjectScope();

  // `undefined` until somebody chooses IN here — see `resolveStandupProject` for
  // why that is different from an explicit "no project".
  const [chosen, setChosen] = useState<number | null | undefined>(undefined);

  const resolved = useMemo(
    () => resolveStandupProject({
      chosen,
      scopeProjectId: scope?.currentProjectId ?? null,
      boardProjectId,
    }),
    [boardProjectId, chosen, scope?.currentProjectId],
  );

  const participants = useMemo<RoomStandupParticipant[]>(
    // Everyone in a canvas room is a person: agents attend through their own
    // seats on the ceremony round table, not through a browser session here.
    () => members.map((member) => ({
      kind: 'human' as const,
      ref: member.userId,
      name: member.displayName || member.userId,
    })),
    [members],
  );

  const standup = useRoomStandup(resolved.projectId, participants);

  const projectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const walkable = projectIds.length > 0;
  const live = !!standup.session;

  const label = resolved.projectId == null
    ? t('allProjects')
    : projects.find((project) => project.id === resolved.projectId)?.name ?? t('projectFallback', { id: resolved.projectId });

  return (
    <CanvasBarGroup caption={t('caption')} label={t('groupLabel')}>
      <div className={styles.standup}>
        <button
          type="button"
          className={styles.standupStep}
          onClick={() => setChosen(stepStandupProject(projectIds, resolved.projectId, -1))}
          disabled={!walkable}
          title={t('previous')}
          aria-label={t('previous')}
        >
          ‹
        </button>

        <label className={styles.standupPicker}>
          <span className={styles.srOnly}>{t('projectLabel')}</span>
          <select
            value={resolved.projectId == null ? '' : String(resolved.projectId)}
            onChange={(event) => setChosen(event.target.value === '' ? null : Number(event.target.value))}
            className={styles.standupSelect}
          >
            <option value="">{t('allProjects')}</option>
            {projects.map((project) => (
              <option key={project.id} value={String(project.id)}>{project.name}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={styles.standupStep}
          onClick={() => setChosen(stepStandupProject(projectIds, resolved.projectId, 1))}
          disabled={!walkable}
          title={t('next')}
          aria-label={t('next')}
        >
          ›
        </button>

        {live ? (
          <>
            <span className={styles.standupLive} role="status">{t('live', { project: label })}</span>
            <button type="button" className={styles.standupAction} onClick={standup.finish} disabled={standup.busy}>
              {standup.busy ? t('finishing') : t('finish')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.standupAction}
            onClick={standup.start}
            // A standup with no project can still be HELD — people are in the
            // room either way — it just has no record to file itself against,
            // which is what the title says rather than hiding the control.
            disabled={standup.busy || resolved.projectId == null}
            title={resolved.projectId == null ? t('needsProject') : undefined}
          >
            {standup.busy ? t('starting') : t('start')}
          </button>
        )}

        {standup.error && (
          <button type="button" className={styles.standupError} onClick={standup.dismissError} title={t('dismiss')}>
            {standup.error}
          </button>
        )}
      </div>
    </CanvasBarGroup>
  );
}
