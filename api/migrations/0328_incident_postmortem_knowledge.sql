-- 0328_incident_postmortem_knowledge.sql
-- Close the incident-management loop into the Knowledge base: post-incident review /
-- RCA / lessons-learned.
--
-- When the Incident Manager agent resolves an incident it authors a Root Cause
-- Analysis and PUBLISHES it as a first-class Knowledge document (reusing the existing
-- knowledge_documents versioning + publish flow, migration 0227), so the learning is
-- durable, searchable, and read-acknowledgeable like any SOP — and the agent can
-- RECALL prior RCAs / known-errors during the next incident's triage.
--
-- Two new knowledge doc_type values ride the existing VARCHAR column (no enum, no
-- migration for the values themselves): 'postmortem' (an incident RCA) and
-- 'known_error' (a documented known error + workaround). The route + UI allow-lists
-- are widened in code (DOC_TYPES).
--
-- source_incident_id gives the durable structured back-link Knowledge → incident (the
-- forward-link incident → doc is stored on prod_incidents.postmortem_url, migration
-- 0236). Idempotent: ADD COLUMN / INDEX IF NOT EXISTS.

ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS source_incident_id UUID;   -- → prod_incidents.id (the RCA's incident)
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_incident ON knowledge_documents(source_incident_id);
