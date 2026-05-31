/**
 * ProgressFeedback — single rendering site for the studio's per-phase progress
 * label + per-run error message.
 *
 * Self-gating per DRY rule: returns `null` when there is nothing to show, so
 * consumers do not branch on `{progress || error ? <ProgressFeedback .../> : null}`
 * — they just always mount it. One source of truth for "what does in-flight
 * feedback look like in this panel," used wherever feedback needs to surface
 * (today: right-column under the video preview; previously: left column under
 * Generate Video; future: a status toast).
 */

interface ProgressFeedbackProps {
  progressLabel: string;
  error: string | null;
}

export function ProgressFeedback({ progressLabel, error }: ProgressFeedbackProps) {
  if (!progressLabel && !error) return null;
  return (
    <div className="bfs-progress-feedback">
      {progressLabel ? <p className="bfs-progress">{progressLabel}</p> : null}
      {error ? <p className="bfs-error">{error}</p> : null}
    </div>
  );
}
