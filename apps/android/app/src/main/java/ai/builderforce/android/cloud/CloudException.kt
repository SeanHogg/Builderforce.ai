package ai.builderforce.android.cloud

/**
 * Why a call to builderforce.ai did not succeed — split the way the app must react: a
 * refused key signs out, an unreachable platform keeps the session and says so. The
 * messages are for logs; the UI shows its own localized text for each kind.
 */
sealed class CloudException(message: String) : Exception(message) {
  /** Nobody is signed in. */
  class SignedOut : CloudException("not signed in to Builderforce")

  /** The platform refused the saved key (revoked or deleted): sign in again. */
  class KeyRejected : CloudException("Builderforce no longer accepts this sign-in")

  /** The platform could not be reached (offline, DNS, timeout). */
  class Unreachable(val detail: String) : CloudException("Builderforce could not be reached: $detail")

  /**
   * The platform answered with an error. [reason] is the body's stable `code`, when it
   * sent one; [detail] is its `error` message.
   */
  class Status(val code: Int, val reason: String?, val detail: String) :
    CloudException("Builderforce answered $code: $detail")
}
