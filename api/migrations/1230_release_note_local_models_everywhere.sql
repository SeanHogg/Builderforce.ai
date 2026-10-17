-- 1230 · Release note: models that run on your own machine, handed off through memory.
--
-- `new`: the model picker (`/` menu → Model → "On this device") now offers models that
-- download once and run in the browser's GPU over WebGPU — 1-bit Bonsai 8B / 4B / 1.7B
-- (PrismML, Apache-2.0, tool calling) on Builderforce's own engine (Synapse's bfi,
-- compiled for the browser) and WebLLM models (Qwen3 1.7B/4B, Llama 3.2 3B, Hermes 3 8B
-- with tool calling). Same picker in the VS Code extension, Rovr and builderforce.ai;
-- models that do not fit the device say why. Prompts for those turns stay on the machine
-- and work offline once downloaded. When a run moves between models (on-device ↔ cloud,
-- plan → code, failover), builderforce-memory packs the conversation for the next
-- model's window (PRD 34, `packHandoff`). Shipped in the web app 2026.10.57.
--
-- Fixed id so the migration is safe to replay; `emailed_at` left NULL so the
-- product-updates digest announces it exactly once.
INSERT INTO release_notes (id, version, title, body, category, stage, published_at) VALUES
  (
    'a1b2c301-0010-4000-8000-000000001230',
    '2026.10.57',
    'Run a model on your own machine, and hand off without losing the thread',
    'Every token you send to a cloud model leaves your machine and is billed, and until now the obvious alternative, a small local model, broke the moment it was handed a conversation bigger than it could hold. Both halves are fixed. Open the / menu, choose Model, then On this device, and download a model once to run it in your browser''s GPU. You can pick 1-bit Bonsai 8B, 4B or 1.7B from PrismML (about 1.16 GB, 0.57 GB and 0.25 GB, all with tool calling), running on Builderforce''s own engine, the same one Synapse uses on the desktop, compiled for the browser. Or pick a WebLLM model: Qwen3 1.7B or 4B, Llama 3.2 3B, or Hermes 3 8B with tool calling. The picker is the same in the VS Code extension, in Rovr and on builderforce.ai, and a model that does not fit your device tells you why instead of failing halfway. On those turns your prompts never leave your machine, nothing is billed, and once the model is downloaded it works offline. When a run moves between models, whether from your device to the cloud, from a planning model to a coding model, or to a backup provider after a failure, builderforce-memory now packs the conversation for the next model''s own window. It keeps your instructions and the recent work word for word and summarises or recalls the rest, so a small on-device model never receives a transcript it cannot hold, and a cloud model picking up after it gets a note of what happened. A few honest limits: you need a browser and GPU with WebGPU, the first download is large, and on-device models are smaller than frontier cloud models. Bonsai 8B holds about 14,000 tokens of context in the browser on a GPU with half-precision support, about 7,000 without.',
    'new',
    'live',
    '2026-10-17 21:00:00'
  )
ON CONFLICT (id) DO NOTHING;
