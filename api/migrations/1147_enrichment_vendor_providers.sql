-- 1147_enrichment_vendor_providers.sql
--
-- Gives `enrichment_cache` a provider to cache.
--
-- `agent/aiOperations.cacheLookup` / `cacheStore` (PRD 19 §9) shipped complete
-- and callerless: Builderforce had no enrichment vendor adapter, so
-- `cacheSavings` reported a column of zeros and `contact_compensations`'
-- `inferred` confidence described a vendor guess nothing in this codebase could
-- make. `sales/contactProfile`'s own docstring records the gap from the other
-- side.
--
-- The three vendors below are the person-enrichment half of the provider
-- catalog's new third family (`ProviderFamily = 'data' | 'marketing' |
-- 'enrichment'`). They connect, test and store a credential through exactly the
-- same path every other integration does, which is why the only schema change
-- they need is somewhere for `integration_credentials.provider` to put them.
--
-- Each bills PER LOOKUP, which is the entire reason the cache exists:
-- `application/enrichment/enrichContact.ts` is the sole entry to any of them and
-- it reads the cache before it will decrypt a credential, so a repeat lookup
-- costs nothing and says so in real cents.
--
-- `ADD VALUE IF NOT EXISTS` is idempotent and cannot run inside a transaction
-- block on older PostgreSQL, which is why these are bare statements — the same
-- form migration 0412 used to add the data + marketing families.

ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'clearbit';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'people_data_labs';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'apollo';
