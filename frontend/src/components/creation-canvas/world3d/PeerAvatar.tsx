/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { Html } from '@react-three/drei';
import { AvatarFace } from '@/components/Avatar';
import { AvatarFigure } from './PlayerAvatar';
import { PeerSpeechBubble } from './PeerSpeechBubble';

/**
 * One other person, drawn where the presence relay says they are.
 *
 * ── WHY IT REUSES THE WALKER'S OWN FIGURE ────────────────────────────────────
 * `AvatarFigure` was already the body the third-person camera draws for YOU.
 * A second figure for other people would be two answers to "what does a person
 * look like here", and the first time one of them gained a detail the two would
 * stop matching — which reads, in a shared space, as though remote people are a
 * different kind of thing from you. They are not. The comment in `PlayerAvatar`
 * even said the source it was ported from shared this figure with remote peers;
 * this is that sharing, restored.
 *
 * ── WHY THE NAME IS DOM AND NOT GEOMETRY ─────────────────────────────────────
 * A name plate has to be legible at any distance, respect the reader's theme,
 * and carry a translated "who is this" for a peer the roster has not named yet.
 * Text drawn into the scene gets none of those for free and needs a font file
 * the page would have to fetch. `Html` puts a real element over the canvas, so
 * the plate uses the app's own tokens and the same string catalogue everything
 * else does.
 */

/** Height of the figure's feet below its group origin, from `AvatarFigure`'s
 *  own box layout (legs reach -0.95). Lifting by this stands it on the floor. */
const FOOT_OFFSET = 0.95;
/** Where the plate floats, measured from the figure's origin. */
const PLATE_HEIGHT = 1.15;
/** Where a speech bubble's bottom edge floats — just clear of the plate. */
const SPEECH_HEIGHT = 1.45;

export interface PeerAvatarProps {
  position: [number, number, number];
  /** Radians about Y. */
  yaw: number;
  color: string;
  /** Already resolved by the caller — a peer with no roster row yet gets the
   *  translated generic label rather than an empty plate. */
  label: string;
  /** Their profile picture: worn as the figure's face, and shown in the plate so
   *  it is visible from behind too. Absent for agents and guests without one. */
  avatarUrl?: string | null;
  /** Dims the plate for somebody seated by assumption rather than by a live
   *  frame, so "in the session" and "here right now" are distinguishable. */
  live: boolean;
  /** What they are saying: an agent's reply to the latest turn, or the translated
   *  "thinking" line while it works. Absent for everyone who has not spoken. */
  speech?: { text: string; pending: boolean } | null;
  /** Show the full reply this bubble excerpts, in the transcript. Absent ⇒ the bubble
   *  is not clickable, which is the right answer while an agent is still thinking. */
  onSelectSpeech?: (() => void) | undefined;
  /** Accessible name for that jump. Translated by the host. */
  selectSpeechLabel?: string | undefined;
}

export function PeerAvatar({ position, yaw, color, label, avatarUrl, live, speech, onSelectSpeech, selectSpeechLabel }: PeerAvatarProps) {
  return (
    <group position={[position[0], position[1] + FOOT_OFFSET, position[2]]} rotation={[0, yaw, 0]}>
      <AvatarFigure color={color} faceUrl={avatarUrl} />
      <Html
        position={[0, PLATE_HEIGHT, 0]}
        center
        distanceFactor={9}
        // The plate must not eat clicks meant for the object wall behind it.
        pointerEvents="none"
        zIndexRange={[10, 0]}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            whiteSpace: 'nowrap',
            padding: '2px 7px',
            // The plate is real DOM (`Html`), so the app's own scale reaches it —
            // which is the whole reason the name is not geometry. See the header.
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-small)',
            lineHeight: 1.4,
            fontWeight: 500,
            background: 'var(--surface, #1a1a1a)',
            color: 'var(--text-primary, #f5f5f5)',
            border: '1px solid var(--border, #333)',
            opacity: live ? 1 : 0.55,
          }}
        >
          {/* An `<img>` needs no CORS, so the plate shows the picture even where the
              face texture could not load — and from behind, where the face is not. */}
          {avatarUrl && <AvatarFace name={label} imageUrl={avatarUrl} color={color} active size={16} />}
          {label}
        </span>
      </Html>
      {speech && (
        <PeerSpeechBubble
          text={speech.text}
          pending={speech.pending}
          height={SPEECH_HEIGHT}
          onSelect={onSelectSpeech}
          selectLabel={selectSpeechLabel}
        />
      )}
    </group>
  );
}

