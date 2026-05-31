/**
 * StoryboardEditor — the review/edit surface for the Director's plan.
 *
 * Cinematic mode is a two-phase flow: PLAN (planScene → Storyboard) then RENDER
 * (generateStoryboard). This component is phase 1's UI: it shows the treatment
 * and character bible, and an EDITABLE shot list (prompt, camera, action,
 * frames) so the user can adjust the director's plan before committing GPU time
 * to render it. After render, each shot carries a validation badge (the VLM's
 * verdict on that shot's keyframes).
 *
 * Owns all storyboard-editing logic (DRY): the consumer passes the storyboard +
 * an onChange and never reaches into individual shot fields.
 */

import {
  CAMERA_MOVES,
  type CameraMove,
  type PlannedShot,
  type ShotValidation,
  type Storyboard,
} from '@seanhogg/builderforce-studio';

interface StoryboardEditorProps {
  storyboard: Storyboard;
  onChange: (next: Storyboard) => void;
  onRender: () => void;
  onReplan: () => void;
  /** Validation verdicts keyed by shot id, shown as badges after a render. */
  validations?: ShotValidation[];
  /** True while planning or rendering — disables editing + buttons. */
  busy?: boolean;
}

export function StoryboardEditor({
  storyboard,
  onChange,
  onRender,
  onReplan,
  validations,
  busy,
}: StoryboardEditorProps) {
  const totalFrames = storyboard.shots.reduce((a, s) => a + s.durationFrames, 0);
  const validationByShot = new Map((validations ?? []).map((v) => [v.shotId, v.validation]));

  const updateShot = (idx: number, patch: Partial<PlannedShot>) => {
    const shots = storyboard.shots.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange({ ...storyboard, shots });
  };

  return (
    <div className="bfs-field" style={{ border: '1px solid var(--bfs-border)', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: '0.9rem' }}>Storyboard</strong>
        <span className="bfs-hint" style={{ margin: 0 }}>
          {storyboard.shots.length} shots · {totalFrames} frames
        </span>
      </div>

      <p className="bfs-hint" style={{ marginTop: 6 }}>
        <strong>Treatment:</strong> {storyboard.treatment}
      </p>

      {storyboard.characters.length > 0 && (
        <p className="bfs-hint" style={{ marginTop: 0 }}>
          <strong>Cast:</strong>{' '}
          {storyboard.characters.map((c) => `${c.name} (${c.appearance})`).join(' · ')}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        {storyboard.shots.map((shot, idx) => {
          const verdict = validationByShot.get(shot.id);
          return (
            <div
              key={shot.id}
              style={{
                border: '1px solid var(--bfs-border)',
                borderRadius: 6,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>Shot {idx + 1}</span>
                {verdict && <ValidationBadge ok={verdict.ok} score={verdict.score} />}
              </div>

              <textarea
                className="bfs-prompt"
                rows={2}
                value={shot.prompt}
                onChange={(e) => updateShot(idx, { prompt: e.target.value })}
                disabled={busy}
                style={{ fontSize: '0.8rem' }}
              />

              <div className="bfs-row">
                <div className="bfs-field bfs-flex" style={{ margin: 0 }}>
                  <label className="bfs-label">Camera</label>
                  <select
                    className="bfs-input"
                    value={shot.camera}
                    onChange={(e) => updateShot(idx, { camera: e.target.value as CameraMove })}
                    disabled={busy}
                  >
                    {CAMERA_MOVES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="bfs-field bfs-flex" style={{ margin: 0 }}>
                  <label className="bfs-label">Frames</label>
                  <input
                    type="number"
                    className="bfs-input"
                    min={1}
                    max={120}
                    value={shot.durationFrames}
                    onChange={(e) =>
                      updateShot(idx, {
                        durationFrames: Math.max(1, Math.min(120, Number(e.target.value) || 1)),
                      })
                    }
                    disabled={busy}
                  />
                </div>
              </div>

              {verdict && verdict.issues.length > 0 && (
                <p className="bfs-hint" style={{ margin: 0 }}>
                  {verdict.issues.map((i) => `${i.kind}: ${i.detail}`).join(' · ')}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="bfs-actions" style={{ marginTop: 10 }}>
        <button type="button" className="bfs-btn bfs-btn-secondary" onClick={onReplan} disabled={busy}>
          Re-plan
        </button>
        <button type="button" className="bfs-btn bfs-btn-primary" onClick={onRender} disabled={busy}>
          Render storyboard
        </button>
      </div>
    </div>
  );
}

/** Pass/fail chip for a shot's VLM verdict. Owns its own colour logic. */
function ValidationBadge({ ok, score }: { ok: boolean; score: number }) {
  return (
    <span
      style={{
        fontSize: '0.7rem',
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: 4,
        color: 'white',
        background: ok ? '#16a34a' : '#dc2626',
      }}
      title={`VLM score ${score.toFixed(2)}`}
    >
      {ok ? '✓' : '✗'} {(score * 100).toFixed(0)}%
    </span>
  );
}
