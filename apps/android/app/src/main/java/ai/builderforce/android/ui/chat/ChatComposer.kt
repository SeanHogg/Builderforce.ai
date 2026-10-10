package ai.builderforce.android.ui.chat

import ai.builderforce.android.R
import ai.builderforce.android.chat.mentionedAgent
import ai.builderforce.android.cloud.Recipient
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * The one-box composer every Builderforce surface draws (web, editor, Synapse, Spawn): one
 * filled box with the text on top and one row under it — `+` to attach images, "To" only
 * when the chat has agents to address, and ONE round trailing button: the mic on an empty
 * box (where the phone can listen), Send once there is text or an image, Stop while a reply runs and
 * the box is empty. Text typed during a reply stays sendable and queues behind it.
 */
@Composable
fun ChatComposer(
  value: String,
  onValueChange: (String) -> Unit,
  attachments: List<PendingImageAttachment>,
  agents: List<Recipient>,
  running: Boolean,
  errorText: String?,
  onPickImages: () -> Unit,
  onRemoveAttachment: (id: String) -> Unit,
  onSend: (to: Recipient?) -> Unit,
  onStop: () -> Unit,
  onDictationDenied: () -> Unit,
  modifier: Modifier = Modifier,
) {
  var toRef by rememberSaveable { mutableStateOf<String?>(null) }
  var focused by remember { mutableStateOf(false) }
  val to = agents.firstOrNull { it.ref == toRef }
  val dictation =
    rememberDictation(
      onPhrase = { phrase -> onValueChange(appendPhrase(value, phrase)) },
      onDenied = onDictationDenied,
    )
  val hasText = value.isNotBlank()
  val active = focused || value.isNotEmpty() || attachments.isNotEmpty()
  val shape = RoundedCornerShape(20.dp)

  Column(modifier = modifier.fillMaxWidth()) {
    Surface(
      shape = shape,
      color = MaterialTheme.colorScheme.surfaceContainerHigh,
      border = if (active) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
      modifier = Modifier.fillMaxWidth(),
    ) {
      Column(modifier = Modifier.padding(start = 6.dp, end = 6.dp, top = 10.dp, bottom = 6.dp)) {
        if (attachments.isNotEmpty()) {
          AttachmentChips(attachments = attachments, onRemove = onRemoveAttachment)
        }
        BasicTextField(
          value = value,
          onValueChange = { next ->
            mentionedAgent(next, agents)?.let { toRef = it.ref }
            onValueChange(next)
          },
          modifier =
            Modifier
              .fillMaxWidth()
              .padding(horizontal = 10.dp, vertical = 4.dp)
              .onFocusChanged { focused = it.isFocused },
          textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
          cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
          minLines = 1,
          maxLines = 6,
          decorationBox = { inner ->
            Box {
              if (value.isEmpty()) {
                Text(
                  stringResource(R.string.chat_placeholder),
                  style = MaterialTheme.typography.bodyLarge,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
              }
              inner()
            }
          },
        )
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          IconButton(onClick = onPickImages, enabled = to == null) {
            Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.chat_attach))
          }
          if (agents.isNotEmpty()) {
            RecipientPicker(to = to, agents = agents, onPick = { toRef = it?.ref })
          }
          Spacer(modifier = Modifier.weight(1f))
          when {
            dictation.listening ->
              RoundAction(
                icon = Icons.Filled.Mic,
                label = stringResource(R.string.chat_stop_dictation),
                container = MaterialTheme.colorScheme.primary,
                content = MaterialTheme.colorScheme.onPrimary,
                onClick = { dictation.stop() },
              )
            hasText || attachments.isNotEmpty() ->
              RoundAction(
                icon = Icons.Filled.ArrowUpward,
                label = stringResource(R.string.chat_send),
                container = MaterialTheme.colorScheme.primary,
                content = MaterialTheme.colorScheme.onPrimary,
                onClick = {
                  onSend(to)
                  toRef = null
                },
              )
            running ->
              RoundAction(
                icon = Icons.Filled.Stop,
                label = stringResource(R.string.chat_stop),
                container = MaterialTheme.colorScheme.onSurface,
                content = MaterialTheme.colorScheme.surface,
                onClick = onStop,
              )
            dictation.available ->
              RoundAction(
                icon = Icons.Filled.Mic,
                label = stringResource(R.string.chat_dictate),
                container = MaterialTheme.colorScheme.secondaryContainer,
                content = MaterialTheme.colorScheme.onSecondaryContainer,
                onClick = { dictation.toggle() },
              )
            else ->
              RoundAction(
                icon = Icons.Filled.ArrowUpward,
                label = stringResource(R.string.chat_send),
                container = MaterialTheme.colorScheme.primary,
                content = MaterialTheme.colorScheme.onPrimary,
                enabled = false,
                onClick = {},
              )
          }
        }
      }
    }
    if (!errorText.isNullOrBlank()) {
      Text(
        text = errorText,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.error,
        maxLines = 3,
        modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 6.dp),
      )
    }
  }
}

/** Each recognised phrase lands after the text as it stands, never over it. */
private fun appendPhrase(current: String, phrase: String): String =
  when {
    current.isEmpty() -> phrase
    current.last().isWhitespace() -> current + phrase
    else -> "$current $phrase"
  }

@Composable
private fun RoundAction(
  icon: ImageVector,
  label: String,
  container: Color,
  content: Color,
  onClick: () -> Unit,
  enabled: Boolean = true,
) {
  FilledIconButton(
    onClick = onClick,
    enabled = enabled,
    shape = CircleShape,
    colors = IconButtonDefaults.filledIconButtonColors(containerColor = container, contentColor = content),
    modifier = Modifier.size(40.dp),
  ) {
    Icon(icon, contentDescription = label)
  }
}

/** "To <name> ▾": the Brain, or one of the chat's assigned agents. */
@Composable
private fun RecipientPicker(to: Recipient?, agents: List<Recipient>, onPick: (Recipient?) -> Unit) {
  var open by remember { mutableStateOf(false) }
  Box {
    TextButton(onClick = { open = true }) {
      Text(
        stringResource(R.string.chat_to, to?.name ?: stringResource(R.string.chat_brain)),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      DropdownMenuItem(
        text = { Text(stringResource(R.string.chat_brain)) },
        onClick = {
          onPick(null)
          open = false
        },
      )
      for (agent in agents) {
        DropdownMenuItem(
          text = { Text(agent.name) },
          onClick = {
            onPick(agent)
            open = false
          },
        )
      }
    }
  }
}

@Composable
private fun AttachmentChips(attachments: List<PendingImageAttachment>, onRemove: (id: String) -> Unit) {
  Row(
    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    for (att in attachments) {
      InputChip(
        selected = false,
        onClick = { onRemove(att.id) },
        label = { Text(att.fileName, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        trailingIcon = {
          Icon(
            Icons.Filled.Close,
            contentDescription = stringResource(R.string.chat_remove_attachment, att.fileName),
            modifier = Modifier.size(16.dp),
          )
        },
      )
    }
  }
}
