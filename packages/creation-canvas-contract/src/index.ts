/** Shared, transport-neutral Creation Canvas contract used by web and VSIX. */
export * from './video';
export * from './talktrack';
export * from './world';
// The AI video/3D generation request a `scene` object carries, and the clip it
// produces — see the module header for why it is not folded into `video.ts`.
export * from './scene';
export * from './robloxWorld';
export * from './canvasTools';
export * from './marketplaceListings';
export * from './dependencyGraph';
export * from './academic';
export * from './qa';
export * from './people';
// The SEAM between the hiring funnel and the employment relationship — an accepted
// `offer` becoming an `employee` and an onboarding `employeeLifecycle`. Declared beside
// both vocabularies and owned by neither; see handover.ts.
export * from './handover';
// The vocabulary a workshop is RUN in — one `poll` kind whose instrument is a value,
// and the counting rule all three surfaces share. See facilitation.ts.
export * from './facilitation';
export * from './dataScience';
export * from './triggers';
// The live-presence frame — the ONE shape the canvas relay carries. Shared because
// the Durable Object sanitizes WITH it and the canvas merges the result; see presence.ts.
export * from './presence';
export * from './operations';
export * from './resume';
// The deterministic résumé READER — plain text to a JSON Resume document, no model.
// It lives beside the `CanvasResumeDocument` type it produces rather than in the API
// because BOTH callers need it: the tenantless upload route, and the canvas turning a
// dropped PDF into a résumé in the visitor's own browser. Two copies would give the
// scorer a bullet the document builder had dropped.
export * from './resumeLexicon';
export * from './resumeModel';
export * from './resumeDocument';
// The formatting a canvas document carries BEYOND markdown — underline, colour, font,
// size and alignment. Shared because the ONE stored form has five readers (card,
// editor, print sheet, .docx/.pdf writers, Brain) and they must spell it identically;
// see richFormat.ts.
export * from './richFormat';
// The counterparty vocabulary — `PARTY_ROLES`, `ACCOUNT_RELATIONSHIPS`, `partyRef`.
// Declared in this package rather than in either consumer because the canvas `account`
// kind, the API's `party_roles` writer and the kernel's own role column must mean the
// same thing on purpose; see `parties.ts`.
export * from './parties';
// The OWNERSHIP vocabulary — share classes, the append-only event ledger the cap table
// is a fold of, vesting (computed, never stored) and SAFE/note conversion. Shared for
// the same reason `parties.ts` is, and for one more: the vesting and conversion
// arithmetic is read by BOTH the projection on the server and the card on the board, and
// a company's ownership computed two ways is the one place two answers is unacceptable.
export * from './equity';
// The authored-website vocabulary, parser and block-level section operations. Shared
// because the `site` surface renders it as React and the site publisher renders the
// SAME object to static HTML in a Worker — two renderers, and a section vocabulary
// stated twice is one that drifts until the publisher drops what the editor allows.
// The one set of device widths every surface that frames OR captures a document reads.
// Shared rather than frontend-local because the gateway's page-capture service needs the
// same numbers — see the module header.
export * from './viewport';
export * from './website';
// The framework-free HTML renderer for that same vocabulary — one document string
// shared by the static site publisher and the canvas `app` surface. See its own header
// for why the pixels live here rather than beside either caller.
export * from './websiteDocument';
// The SELL-MOTION vocabulary — the commercial half of "idea to real": the priced quote a
// buyer can accept, the cadence that follows up, the call that actually happened, the
// trial, the trust packet a security review needs, and the plan both sides own. Shared
// because the arithmetic is read by THREE consumers that must never disagree — the
// seller's card, the buyer-facing page served to somebody with no account, and the Worker
// route that turns an acceptance into a checkout intent. See its own header.
export * from './sellMotion';
// DATA GOVERNANCE — the classification vocabulary and the dataset-use gate. Shared
// because the use it most needs to refuse is a FINE-TUNE, dispatched by the API, which
// cannot import the frontend module the gate used to live in. See its own header.
export * from './dataGovernance';
// The CAREER vocabulary — the SAME hiring transaction from the seeker's side: the
// posting somebody else opened, the application as a projection of the `job_proposals`
// row that already owns its lifecycle, the pipeline that is a shortlist transposed, the
// letter, the rehearsal, and the personal runway every other decision is paced against.
// Shared because the guest canvas authors these with no tenant and no API call, and the
// runway band it lands in must be the band `application/career/runway.ts` would compute.
export * from './career';
// The MARKETING vocabulary — the brand a generative board composes against and the
// audience a send may lawfully reach. Shared for two reasons the module argues in full:
// the brand directive is composed into a prompt by BOTH the browser and the API's
// creative dispatch, and the sendable arithmetic is printed on the campaign card AND
// decides whether the send control refuses.
export * from './marketing';
// ANYTHING THAT IS A DATE WITH A SUBJECT — the event shape, the day/week/month grain,
// the conflict rule, and the projection that reads a board's own dates as events. It
// used to live inside `marketing.ts` and to serve exactly one hardcoded reading; a
// deployment, a holiday and an on-call shift are the same shape and were unreachable.
export * from './calendar';
// A card's RESOURCE REF (`"<type>:<id>"`) — the string that says which real record a
// board card stands for. Shared because the API WRITES the two halves and the canvas
// RESOLVES cards back from them; see resourceRef.ts.
export * from './resourceRef';
// The CREATION LIBRARY's rules — what "everything you have made" is as ONE list, how
// it is ordered and deduped, and the facet vocabulary. Shared because three surfaces
// draw that list (the web library, the VS Code Sessions tree, and the panel its rows
// open) and all three were sectioning it differently; see creationLibrary.ts.
export * from './creationLibrary';

export * from './slug';
// Least squares and the trailing mean — the arithmetic every forecast shares.
export * from './series';
export * from './html';
// The object vocabulary — every kind, the named families, the legacy renames, and the
// connection and command kinds. It was this file's own body until the entry point was
// made only a barrel; see objectKinds.ts.
export * from './objectKinds';
// What each creative kind can be exported as, who produces each format, and where a
// finished artifact can be published. See creativeCapabilities.ts.
export * from './creativeCapabilities';
