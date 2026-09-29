-- 1190 · Release note: publish a trained Evermind to the Hugging Face Hub from the
-- export panel, with your own token.
--
-- `new`: before this, a trained model left Builderforce only as a downloaded zip, and
-- getting it onto the Hub was a separate job outside the product (unpack, install the
-- Hub tools, log in, create the repo, upload the weights). Publishing to a Hub repo is
-- a destination a person could not reach from Builderforce at all.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0009-4000-8000-000000001190',
    '2026.9.41',
    'Publish your Evermind to Hugging Face',
    'A model you trained can now go straight onto the Hugging Face Hub. In the LLM Studio export panel, pick Hugging Face repo, name the repository as owner/name, paste a Hugging Face token with write access and choose whether it starts private. The full repo (safetensors, ONNX and GGUF weights, config, tokenizer and model card) is created and uploaded for you, and the link appears when it finishes. Your token goes from the page directly to Hugging Face; Builderforce never receives or stores it, and the repository is yours. Publishing again adds a new version to the same repository, and the download is still there for an offline copy.',
    'new',
    'live',
    '2026-09-28 22:00:00'
  )
ON CONFLICT (id) DO NOTHING;
