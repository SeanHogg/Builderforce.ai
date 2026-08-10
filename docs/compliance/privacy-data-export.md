# Privacy data export evidence

Authenticated users call `GET /api/auth/me/privacy-export` to download a no-store JSON bundle containing their account, workspace memberships, legal acceptances, and privacy-request record. Workspace chats, ideas, artifacts, code, and project content retain their native product export paths and must be included in a formal access/portability fulfillment under `privacy-rights-fulfillment.md`. The quarterly synthetic-user test validates completeness against the data inventory.
