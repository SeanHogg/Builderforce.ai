-- Migration: seal the voice-clone speaker embedding (expand step).
--
-- The speaker embedding is the owner's biometric. studio_voice_clones.embedding
-- (jsonb) held it in PLAINTEXT. EXPAND: add the sealed columns (AES-256-GCM,
-- per-tenant key via credentialCrypto, `v2:<base64>` + hex IV). The app stops
-- writing the plaintext column and seals+nulls any legacy plaintext row on its
-- first owner fetch (the key lives in the Worker, so SQL cannot backfill it).
-- CONTRACT (drop of `embedding`) is held for a later push, after the lazy seal
-- has run its course. Idempotent.

ALTER TABLE studio_voice_clones ADD COLUMN IF NOT EXISTS embedding_enc TEXT;
ALTER TABLE studio_voice_clones ADD COLUMN IF NOT EXISTS embedding_iv VARCHAR(32);
