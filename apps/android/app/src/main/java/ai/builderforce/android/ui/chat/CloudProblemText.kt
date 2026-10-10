package ai.builderforce.android.ui.chat

import ai.builderforce.android.R
import ai.builderforce.android.cloud.CloudProblem
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

/** A cloud failure in the person's language. */
@Composable
fun cloudProblemText(problem: CloudProblem): String {
  val detail = problem.detail.orEmpty()
  return when (problem.kind) {
    CloudProblem.Kind.SignedOut -> stringResource(R.string.cloud_error_signed_out)
    CloudProblem.Kind.KeyRejected -> stringResource(R.string.cloud_error_key_rejected)
    CloudProblem.Kind.Unreachable -> stringResource(R.string.cloud_error_unreachable, detail)
    CloudProblem.Kind.Server -> stringResource(R.string.cloud_error_server, detail)
    CloudProblem.Kind.EmptyAnswer -> stringResource(R.string.cloud_error_empty_answer)
    CloudProblem.Kind.Unexpected -> stringResource(R.string.cloud_error_unexpected, detail)
  }
}
