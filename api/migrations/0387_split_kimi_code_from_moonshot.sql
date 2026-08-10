-- Kimi Code subscription keys and Moonshot Open Platform keys use different,
-- non-interchangeable API hosts. Rows created before this migration were always
-- dispatched to api.moonshot.cn, so preserve their behavior under the explicit
-- `moonshot` provider id. The now-free `kimi` id targets api.kimi.com/coding/v1.
UPDATE tenant_llm_provider_keys
SET provider = 'moonshot', updated_at = NOW()
WHERE provider = 'kimi';
