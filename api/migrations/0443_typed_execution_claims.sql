-- Evidence contracts for assertions beyond code completion.
CREATE OR REPLACE FUNCTION attach_execution_claim_evidence() RETURNS TRIGGER AS $$
DECLARE attached INTEGER;
BEGIN
  INSERT INTO execution_claim_evidence (claim_id, tool_audit_event_id, tenant_id)
  SELECT NEW.id, e.id, NEW.tenant_id FROM tool_audit_events e
   WHERE e.tenant_id = NEW.tenant_id AND e.execution_id = NEW.execution_id
     AND (
       (NEW.kind = 'code_completion' AND e.category = 'tool' AND e.tool_name ~ '^(write_file|edit_file|delete_file|run_checks|run_command|git_)') OR
       (NEW.kind = 'validation' AND e.category = 'tool' AND e.tool_name ~ '^(run_checks|run_command)$') OR
       (NEW.kind = 'review_verdict' AND e.category = 'tool' AND e.tool_name = 'builtin_reviews_record') OR
       (NEW.kind = 'delivery' AND e.category = 'tool' AND e.tool_name IN ('pr_opened','pr_merged')) OR
       (NEW.kind = 'human_message' AND e.category = 'message' AND e.tool_name = 'agent.message')
     )
     AND COALESCE(LOWER(e.result), '') NOT LIKE '%"ok":false%'
     AND COALESCE(LOWER(e.result), '') NOT LIKE '%failed%'
     AND COALESCE(LOWER(e.result), '') NOT LIKE 'blocked %'
     AND COALESCE(LOWER(e.result), '') NOT LIKE '% refused%';
  GET DIAGNOSTICS attached = ROW_COUNT;
  IF attached = 0 THEN RAISE EXCEPTION '% claim requires qualifying successful evidence', NEW.kind; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
