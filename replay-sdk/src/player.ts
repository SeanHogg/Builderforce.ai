/**
 * The replay player bundle published to the CDN (PRD 33 D5): rrweb's
 * `Replayer` as an IIFE global (`BuilderforceReplayPlayer.Replayer`).
 *
 * The frontend and the MP4 export renderer load this file at runtime from
 * the hashed path named in `replay/manifest.json` (`player`), so rrweb is
 * never a frontend dependency and the recorder and player always share one
 * pinned rrweb version (D1).
 */
export { Replayer } from 'rrweb';
