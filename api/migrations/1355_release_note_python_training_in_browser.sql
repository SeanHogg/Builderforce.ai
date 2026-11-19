-- 1355 · Release note: a project's Python training script now runs in the browser tab, and its
-- LoRA adapter becomes a model you can publish and call.
--
-- `new`: PRD 31 §W9 phase 7. A blueprint `training` service (`python train.py`) runs on the
-- browser run target with `import torch` / `import peft` (@webdit/torch on WebGPU), checkpoints
-- when it is stopped, and keeps its saved adapter in the tab; the training panel loads that save
-- as the same adapter the in-browser trainer makes, so publishing and generation take it unchanged.
-- Honest limits stated in the copy: WebGPU required for GPU speed, small models, LoRA adapters only.
--
-- Marketing copy, framed on what a person can now DO (see the header of 1105). Fixed id so the
-- migration is safe to replay; `emailed_at` left NULL so the product-updates digest announces it
-- exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0019-4000-8000-000000001355',
    '2026.11.152',
    'Train a LoRA adapter in Python, in your browser tab',
    'Fine-tuning used to mean renting a GPU box, installing PyTorch and copying weights around before you could find out whether your data changed anything. Now a Python training script in your project runs in the browser tab you built it in. Declare it as a training service in builderforce.json, press Run, and `import torch` and `import peft` work inside the tab on your GPU through WebGPU. The script logs its loss as it goes, saves its adapter when it finishes (or checkpoints when you stop it), and that save stays in your browser. Open the training panel, load the saved adapter, and publish it as a model you can call and test, the same way as an adapter trained in the panel. The adapter targets the token embedding of an Evermind base model (in your script, an `nn.Linear` named `embed_tokens` holding that embedding). It is built for small models and LoRA adapters: you need a browser with WebGPU for GPU speed (without it, training falls back to the much slower CPU), and large models still belong on cloud training.',
    'new',
    'live',
    '2026-11-18 14:00:00'
  )
ON CONFLICT (id) DO NOTHING;
