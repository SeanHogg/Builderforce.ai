package ai.builderforce.android.ui.chat

import ai.builderforce.android.R
import ai.builderforce.android.cloud.SignInState
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.core.net.toUri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/**
 * Signed out, the chat sheet is this: "Sign in to Builderforce" through the browser (the
 * device flow) — the code to enter, a button that opens the approval page, and Cancel.
 */
@Composable
fun SignInCard(
  state: SignInState,
  expired: Boolean,
  onSignIn: () -> Unit,
  onCancel: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val context = LocalContext.current
  var noBrowser by remember { mutableStateOf(false) }
  val open = { url: String -> noBrowser = !openInBrowser(context, url) }

  // The approval page opens by itself once there is a code; the button reopens it.
  if (state is SignInState.Waiting) {
    LaunchedEffect(state.verificationUrl) { open(state.verificationUrl) }
  }

  Surface(
    shape = RoundedCornerShape(20.dp),
    color = MaterialTheme.colorScheme.surfaceContainerHigh,
    modifier = modifier.fillMaxWidth(),
  ) {
    Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(stringResource(R.string.signin_title), style = MaterialTheme.typography.titleLarge)
      when (state) {
        SignInState.Idle, is SignInState.Failed -> {
          Text(
            stringResource(R.string.signin_body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          val failure =
            when {
              state is SignInState.Failed ->
                when (state.reason) {
                  SignInState.Failed.Reason.Denied -> stringResource(R.string.signin_failed_denied)
                  SignInState.Failed.Reason.Expired -> stringResource(R.string.signin_failed_expired)
                  SignInState.Failed.Reason.Unreachable -> stringResource(R.string.signin_failed_unreachable)
                }
              expired -> stringResource(R.string.signin_expired)
              else -> null
            }
          failure?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
          Button(onClick = onSignIn) { Text(stringResource(R.string.signin_button)) }
        }
        SignInState.Starting -> {
          Text(
            stringResource(R.string.signin_starting),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          TextButton(onClick = onCancel) { Text(stringResource(R.string.signin_cancel)) }
        }
        is SignInState.Waiting -> {
          Text(stringResource(R.string.signin_enter_code), style = MaterialTheme.typography.bodyMedium)
          Text(
            state.userCode,
            style = MaterialTheme.typography.headlineMedium,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.primary,
          )
          Text(
            stringResource(R.string.signin_waiting),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          if (noBrowser) {
            Text(stringResource(R.string.signin_no_browser), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
          }
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { open(state.verificationUrl) }) { Text(stringResource(R.string.signin_open_browser)) }
            TextButton(onClick = onCancel) { Text(stringResource(R.string.signin_cancel)) }
          }
        }
      }
    }
  }
}

private fun openInBrowser(context: Context, url: String): Boolean =
  try {
    context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
  } catch (_: ActivityNotFoundException) {
    false
  }
