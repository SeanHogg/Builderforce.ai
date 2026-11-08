-- hiring_ref_salts (1332) is tenant-owned but was created without the tenants FK its sibling
-- hiring tables carry (job_posting_distributions, 1206: REFERENCES tenants(id) ON DELETE
-- CASCADE), so deleting a tenant left its salt row behind. Tenant deletion is the erasure path;
-- a salt that outlives its tenant is exactly the leftover that path must not have.
--
-- Expand-only: orphan rows (a salt whose tenant is already gone) are removed first, then the
-- constraint is added NOT VALID and validated, so the ADD takes only a brief lock and the
-- validation scan does not block writes.
DELETE FROM hiring_ref_salts s
 WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = s.tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'hiring_ref_salts_tenant_id_fkey'
       AND conrelid = 'hiring_ref_salts'::regclass
  ) THEN
    ALTER TABLE hiring_ref_salts
      ADD CONSTRAINT hiring_ref_salts_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE hiring_ref_salts VALIDATE CONSTRAINT hiring_ref_salts_tenant_id_fkey;
