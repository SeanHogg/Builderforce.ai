/**
 * predict/prediction.ts — THE shape every Part D model answers with (PRD 41 §D0.2): the value with its uncertainty and its
 * provenance, so any shown prediction can be replayed (§D12 audit: model version + `inputDigest`).
 *
 * D0: a prediction never sets or changes a verdict. It is rendered apart (the card's "Predicted" block, ≈ wording, no verdict
 * colours), and a model below its data threshold answers `insufficient-data`, which a surface shows as nothing.
 *
 * Pure types: no I/O, no clock, no randomness.
 */
export {};
//# sourceMappingURL=prediction.js.map