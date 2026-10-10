package ai.builderforce.android.cloud

/** A failure as the UI says it: the kind picks the localized sentence, [detail] fills it. */
data class CloudProblem(val kind: Kind, val detail: String? = null) {
  enum class Kind {
    SignedOut,
    KeyRejected,
    Unreachable,
    Server,
    EmptyAnswer,
    Unexpected,
  }

  companion object {
    fun of(error: Throwable): CloudProblem =
      when (error) {
        is CloudException.SignedOut -> CloudProblem(Kind.SignedOut)
        is CloudException.KeyRejected -> CloudProblem(Kind.KeyRejected)
        is CloudException.Unreachable -> CloudProblem(Kind.Unreachable, error.detail)
        is CloudException.Status -> CloudProblem(Kind.Server, error.detail)
        is EmptyAnswerException -> CloudProblem(Kind.EmptyAnswer)
        else -> CloudProblem(Kind.Unexpected, error.message ?: error.javaClass.simpleName)
      }
  }
}
