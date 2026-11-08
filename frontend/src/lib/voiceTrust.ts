/**
 * How far the public verify page may trust a record: only `verified` (the audio in hand IS the
 * signed audio, on a record the platform itself made) earns the success tone.
 */
export type VoiceTrust = 'verified' | 'self_reported' | 'watermark_only';

interface TrustInputs {
  trust?: VoiceTrust;
  audioMatchesSignedHash?: boolean;
  selfReported?: boolean;
}

/** The server's `trust` when present; otherwise computed from the same two facts it is derived from. */
export function voiceTrustOf(view: TrustInputs): VoiceTrust {
  if (view.trust === 'verified' || view.trust === 'self_reported' || view.trust === 'watermark_only') return view.trust;
  const matches = view.audioMatchesSignedHash === true;
  const selfReported = view.selfReported === true;
  if (matches && !selfReported) return 'verified';
  if (selfReported && matches) return 'self_reported';
  return 'watermark_only';
}
