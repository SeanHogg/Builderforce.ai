# Privacy data deletion evidence

Authenticated deletion requests use `POST /api/auth/me/privacy-requests` with `requestType: deletion`. The record is identity-verified, deadline-tracked, and cannot be completed without fulfillment evidence, processor deletion status, and backup disposition. Operators follow `privacy-rights-fulfillment.md`: delete/anonymize primary stores, issue and verify processor instructions, preserve only documented exceptions, and validate backup tombstone replay/expiry.
