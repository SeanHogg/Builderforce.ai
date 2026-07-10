-- 0322_split_llm_modality_to_evermind.sql
--
-- The combined `llm` IDE modality (a single Studio that mixed Evermind teaching with
-- classic LoRA fine-tuning) is split into two distinct project types: `evermind` (the
-- living, self-teaching model) and `finetune` (classic LoRA train/publish/export).
--
-- Existing `llm` projects were created with an Evermind recipe and seeded a working
-- Evermind, so they ARE Evermind projects — migrate them to `evermind`. Both the IDE
-- project row and its backing storage project carry the modality (they are kept in
-- sync at create time), so rewrite both. `modality` is free-text (no enum), so this is
-- a plain UPDATE. The frontend also aliases legacy `llm` -> `evermind` at read time
-- (getModality), so this migration is belt-and-suspenders for durability + queries.
UPDATE ide_projects SET modality = 'evermind' WHERE modality = 'llm';
UPDATE projects     SET modality = 'evermind' WHERE modality = 'llm';
