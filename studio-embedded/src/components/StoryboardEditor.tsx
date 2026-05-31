/**
 * StoryboardEditor — the review/edit surface for the Director's plan.
 *
 * Cinematic mode is a two-phase flow: PLAN (planScene → Storyboard) then RENDER
 * (generateStoryboard). This component is phase 1's UI. It exposes FULL editing
 * of the plan before any GPU time is spent:
 *   • character bible — edit name/appearance, add, remove (removal also drops the
 *     character from every shot's cast).
 *   • shots — edit prompt/camera/frames, toggle which characters appear, add a
 *     shot, delete a shot, reorder (move up/down).
 * After render, each shot carries a VLM validation badge.
 *
 * Owns all storyboard-editing logic (DRY): the consumer passes the storyboard +
 * one onChange and never reaches into individual fields.
 */

import {
  CAMERA_MOVES,
  storyboardFrameCount,
  type CameraMove,
  type CharacterBible,
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

/** First `prefix-N` id not already used in `taken` — stable + collision-free
 *  without needing Date.now()/random (keeps the component deterministic). */
function uniqueId(prefix: string, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

export function StoryboardEditor({
  storyboard,
  onChange,
  onRender,
  onReplan,
  validations,
  busy,
}: StoryboardEditorProps) {
  const { shots, characters } = storyboard;
  const totalFrames = storyboardFrameCount(storyboard);
  const validationByShot = new Map((validations ?? []).map((v) => [v.shotId, v.validation]));

  // ── shot mutations ────────────────────────────────────────────────────────
  const updateShot = (idx: number, patch: Partial<PlannedShot>) =>
    onChange({ ...storyboard, shots: shots.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });

  const addShot = () => {
    const id = uniqueId('shot', new Set(shots.map((s) => s.id)));
    const newShot: PlannedShot = {
      id,
      prompt: '',
      characterIds: [],
      camera: 'static',
      action: '',
      durationFrames: 4,
    };
    onChange({ ...storyboard, shots: [...shots, newShot] });
  };

  const removeShot = (idx: number) =>
    onChange({ ...storyboard, shots: shots.filter((_, i) => i !== idx) });

  const moveShot = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= shots.length) return;
    const next = shots.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange({ ...storyboard, shots: next });
  };

  const toggleShotCharacter = (idx: number, charId: string) => {
    const has = shots[idx].characterIds.includes(charId);
    const characterIds = has
      ? shots[idx].characterIds.filter((c) => c !== charId)
      : [...shots[idx].characterIds, charId];
    updateShot(idx, { characterIds });
  };

  // ── character bible mutations ─────────────────────────────────────────────
  const updateCharacter = (idx: number, patch: Partial<CharacterBible>) =>
    onChange({
      ...storyboard,
      characters: characters.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    });

  const addCharacter = () => {
    const id = uniqueId('char', new Set(characters.map((c) => c.id)));
    onChange({
      ...storyboard,
      characters: [...characters, { id, name: 'New character', appearance: '' }],
    });
  };

  const removeCharacter = (idx: number) => {
    const removedId = characters[idx].id;
    onChange({
      ...storyboard,
      characters: characters.filter((_, i) => i !== idx),
      // Drop the removed character from every shot's cast so no shot references
      // a deleted id (the engine would otherwise just ignore it, but the UI
      // should stay consistent).
      shots: shots.map((s) => ({
        ...s,
        characterIds: s.characterIds.filter((cid) => cid !== removedId),
      })),
    });
  };

  return (
    <div className="bfs-field" style={{ border: '1px solid var(--bfs-border)', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: '0.9rem' }}>Storyboard</strong>
        <span className="bfs-hint" style={{ margin: 0 }}>
          {shots.length} shots · {totalFrames} frames
        </span>
      </div>

      <p className="bfs-hint" style={{ marginTop: 6 }}>
        <strong>Treatment:</strong> {storyboard.treatment}
      </p>

      {/* ── Character bible (editable) ── */}
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="bfs-label">Cast</span>
          <button
            type="button"
            className="bfs-btn bfs-btn-secondary"
            onClick={addCharacter}
            disabled={busy}
            style={{ fontSize: '0.75rem', padding: '2px 8px' }}
          >
            + Character
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {characters.map((c, i) => (
            <div key={c.id} className="bfs-row" style={{ alignItems: 'center' }}>
              <input
                className="bfs-input"
                style={{ flex: '0 0 30%', fontSize: '0.8rem' }}
                value={c.name}
                onChange={(e) => updateCharacter(i, { name: e.target.value })}
                disabled={busy}
                aria-label={`Character ${i + 1} name`}
              />
              <input
                className="bfs-input"
                style={{ flex: 1, fontSize: '0.8rem' }}
                placeholder="locked appearance (age, build, hair, wardrobe, palette)"
                value={c.appearance}
                onChange={(e) => updateCharacter(i, { appearance: e.target.value })}
                disabled={busy}
                aria-label={`Character ${i + 1} appearance`}
              />
              <button
                type="button"
                className="bfs-btn bfs-btn-secondary"
                onClick={() => removeCharacter(i)}
                disabled={busy}
                title="Remove character"
                style={{ fontSize: '0.75rem', padding: '2px 8px' }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Shots (editable + reorderable) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        {shots.map((shot, idx) => {
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
                <span style={{ flex: 1 }} />
                <button type="button" className="bfs-btn bfs-btn-secondary" onClick={() => moveShot(idx, -1)} disabled={busy || idx === 0} title="Move up" style={{ fontSize: '0.75rem', padding: '2px 6px' }}>↑</button>
                <button type="button" className="bfs-btn bfs-btn-secondary" onClick={() => moveShot(idx, 1)} disabled={busy || idx === shots.length - 1} title="Move down" style={{ fontSize: '0.75rem', padding: '2px 6px' }}>↓</button>
                <button type="button" className="bfs-btn bfs-btn-secondary" onClick={() => removeShot(idx)} disabled={busy} title="Delete shot" style={{ fontSize: '0.75rem', padding: '2px 6px' }}>✕</button>
              </div>

              <textarea
                className="bfs-prompt"
                rows={2}
                value={shot.prompt}
                onChange={(e) => updateShot(idx, { prompt: e.target.value })}
                disabled={busy}
                style={{ fontSize: '0.8rem' }}
                aria-label={`Shot ${idx + 1} prompt`}
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

              {/* Cast assignment — which characters appear in this shot. Their
                  locked appearance is appended to the shot prompt at render. */}
              {characters.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {characters.map((c) => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={shot.characterIds.includes(c.id)}
                        onChange={() => toggleShotCharacter(idx, c.id)}
                        disabled={busy}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}

              {verdict && verdict.issues.length > 0 && (
                <p className="bfs-hint" style={{ margin: 0 }}>
                  {verdict.issues.map((i) => `${i.kind}: ${i.detail}`).join(' · ')}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="bfs-btn bfs-btn-secondary"
        onClick={addShot}
        disabled={busy}
        style={{ marginTop: 8, fontSize: '0.8rem' }}
      >
        + Add shot
      </button>

      <div className="bfs-actions" style={{ marginTop: 10 }}>
        <button type="button" className="bfs-btn bfs-btn-secondary" onClick={onReplan} disabled={busy}>
          Re-plan
        </button>
        <button
          type="button"
          className="bfs-btn bfs-btn-primary"
          onClick={onRender}
          disabled={busy || shots.length === 0}
        >
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
