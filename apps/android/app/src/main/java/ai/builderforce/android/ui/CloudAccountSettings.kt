package ai.builderforce.android.ui

import ai.builderforce.android.R
import ai.builderforce.android.cloud.CloudAccount
import ai.builderforce.android.cloud.CloudConfig
import ai.builderforce.android.ui.chat.cloudProblemText
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

/**
 * Settings' Builderforce account: signed in or not, the workspace chats run in (switchable),
 * sign out, and the server the app talks to (a developer override; blank = builderforce.ai).
 */
@Composable
fun CloudAccountSettings(account: CloudAccount) {
  val signedIn by account.signedIn.collectAsState()
  val workspaces by account.workspaces.collectAsState()
  val workspaceId by account.workspaceId.collectAsState()
  val baseUrlOverride by account.baseUrlOverride.collectAsState()
  val problem by account.problem.collectAsState()
  var server by remember(baseUrlOverride) { mutableStateOf(baseUrlOverride) }

  LaunchedEffect(signedIn) {
    if (signedIn) account.refreshWorkspaces()
  }

  Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
    Text(stringResource(R.string.settings_account_title), style = MaterialTheme.typography.titleSmall)
    if (signedIn) {
      val current = workspaces.firstOrNull { it.id == workspaceId }
      var open by remember { mutableStateOf(false) }
      ListItem(
        headlineContent = { Text(stringResource(R.string.settings_account_workspace)) },
        supportingContent = { Text(stringResource(R.string.settings_account_signed_in)) },
        trailingContent = {
          Box {
            TextButton(onClick = { open = true }, enabled = workspaces.isNotEmpty()) {
              Text(current?.name ?: stringResource(R.string.settings_account_workspace_none), maxLines = 1)
              Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
              for (ws in workspaces) {
                DropdownMenuItem(
                  text = { Text(ws.name) },
                  trailingIcon = { if (ws.id == workspaceId) Icon(Icons.Filled.Check, contentDescription = null) },
                  onClick = {
                    open = false
                    account.selectWorkspace(ws.id)
                  },
                )
              }
            }
          }
        },
      )
      OutlinedButton(onClick = account::signOut) { Text(stringResource(R.string.settings_account_sign_out)) }
    } else {
      Text(stringResource(R.string.settings_account_signed_out), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    problem?.let { Text(cloudProblemText(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedTextField(
        value = server,
        onValueChange = { server = it },
        label = { Text(stringResource(R.string.settings_account_server)) },
        placeholder = { Text(CloudConfig.DEFAULT_BASE_URL) },
        supportingText = { Text(stringResource(R.string.settings_account_server_note)) },
        singleLine = true,
        modifier = Modifier.weight(1f),
      )
      TextButton(onClick = { account.setBaseUrl(server) }, enabled = server.trim() != baseUrlOverride) {
        Text(stringResource(R.string.settings_account_server_apply))
      }
    }
  }
}
