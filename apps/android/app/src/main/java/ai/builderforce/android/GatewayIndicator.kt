package ai.builderforce.android

/** Connection phase shown by the status pill dot. */
enum class GatewayPhase {
  Connected,
  Connecting,
  Error,
  Offline,
}

/** Pairing activity the gateway reported (read from its raw, untranslated error detail). */
enum class PairingHint {
  Repairing,
  ApprovalPending,
}

/**
 * Typed gateway status for the UI. The human-readable, localized line lives in
 * `NodeRuntime.statusText`; the UI derives its pill state from this, never by parsing text.
 */
data class GatewayIndicator(
  val phase: GatewayPhase,
  val pairing: PairingHint? = null,
)
