# Global Privacy Control implementation

`CookieConsentManager.tsx` reads `navigator.globalPrivacyControl`. When true it overrides an older analytics/marketing opt-in, persists the GPC state, disables optional categories, and disables the Accept control. Because BuilderForce does not sell/share data or perform targeted advertising, no downstream sale/share signal is required; if such a feature is proposed, server-side `Sec-GPC: 1` handling and a durable opt-out ledger are release prerequisites.
