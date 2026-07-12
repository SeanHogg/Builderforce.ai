/// Enum for dispute states
/// Source: UPwork Gap P1-7
library;

enum DisputeState {
  open,
  underReview,
  mediationPhase,
  awaitingPartyAgreement,
  platformDecision,
  resolvedReleased,
  resolvedRefunded,
  canceled,
}