package ai.builderforce.android.ui.chat

import ai.builderforce.android.R
import ai.builderforce.android.chat.LiveReply
import ai.builderforce.android.chat.QueuedMessage
import ai.builderforce.android.chat.ToolApproval
import ai.builderforce.android.cloud.BrainMessage
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/** One turn: who said it (you, the Brain, or the agent that replied) and who it was for. */
@Composable
fun ChatMessageBubble(message: BrainMessage) {
  val isUser = message.role == "user"
  val author =
    when {
      isUser -> stringResource(R.string.chat_you)
      else -> message.authorName ?: stringResource(R.string.chat_brain)
    }
  val container = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh
  val content = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
  Row(
    modifier = Modifier.fillMaxWidth(),
    horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
  ) {
    Surface(shape = RoundedCornerShape(16.dp), color = container, modifier = Modifier.fillMaxWidth(0.92f)) {
      Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        BubbleHeader(
          author = author,
          to = message.addressedTo.takeIf { it.isNotEmpty() }?.joinToString(", "),
          color = content,
        )
        ChatMarkdown(text = message.content, textColor = content)
      }
    }
  }
}

@Composable
private fun BubbleHeader(author: String, to: String?, color: Color) {
  Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(author, style = MaterialTheme.typography.labelLarge, color = color)
    if (to != null) {
      Text(stringResource(R.string.chat_to, to), style = MaterialTheme.typography.labelMedium, color = color.copy(alpha = 0.75f))
    }
  }
}

/** The Brain's reply while it is written: the answer so far, the tool in use, a tool to approve. */
@Composable
fun LiveReplyBubble(live: LiveReply, onDecide: (approve: Boolean) -> Unit) {
  Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
    Surface(
      shape = RoundedCornerShape(16.dp),
      color = MaterialTheme.colorScheme.surfaceContainerHigh,
      modifier = Modifier.fillMaxWidth(0.92f),
    ) {
      Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        BubbleHeader(author = stringResource(R.string.chat_brain), to = null, color = MaterialTheme.colorScheme.onSurface)
        if (live.draft.isBlank()) {
          ThinkingRow(label = stringResource(R.string.chat_thinking))
        } else {
          ChatMarkdown(text = live.draft, textColor = MaterialTheme.colorScheme.onSurface)
        }
        live.activity?.let { tool ->
          Text(
            stringResource(R.string.chat_using_tool, tool),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        live.approval?.let { ToolApprovalCard(it, onDecide) }
      }
    }
  }
}

@Composable
private fun ToolApprovalCard(approval: ToolApproval, onDecide: (approve: Boolean) -> Unit) {
  Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
    Column(modifier = Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Text(
        stringResource(R.string.chat_tool_ask, approval.label),
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSecondaryContainer,
      )
      Text(
        stringResource(R.string.chat_tool_ask_body),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSecondaryContainer,
      )
      if (approval.arguments.isNotBlank() && approval.arguments != "{}") {
        Text(
          approval.arguments,
          style = MaterialTheme.typography.bodySmall,
          fontFamily = FontFamily.Monospace,
          color = MaterialTheme.colorScheme.onSecondaryContainer,
          maxLines = 6,
        )
      }
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { onDecide(true) }) { Text(stringResource(R.string.chat_tool_approve)) }
        OutlinedButton(onClick = { onDecide(false) }) { Text(stringResource(R.string.chat_tool_deny)) }
      }
    }
  }
}

/** A message typed during a reply, waiting its turn. */
@Composable
fun QueuedMessageBubble(message: QueuedMessage, onUnqueue: () -> Unit) {
  Row(modifier = Modifier.fillMaxWidth().alpha(0.7f), horizontalArrangement = Arrangement.End) {
    Surface(
      shape = RoundedCornerShape(16.dp),
      color = MaterialTheme.colorScheme.primaryContainer,
      modifier = Modifier.fillMaxWidth(0.92f),
    ) {
      Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
        Text(message.text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text(
            stringResource(R.string.chat_queued),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.weight(1f),
          )
          TextButton(onClick = onUnqueue) { Text(stringResource(R.string.chat_unqueue)) }
        }
      }
    }
  }
}

/** An agent was addressed and has not answered yet. */
@Composable
fun AwaitingAgentBubble(names: String) {
  Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
      Row(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
        ThinkingRow(label = stringResource(R.string.chat_waiting_agent, names))
      }
    }
  }
}

@Composable
private fun ThinkingRow(label: String) {
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
      PulseDot(alpha = 0.38f)
      PulseDot(alpha = 0.62f)
      PulseDot(alpha = 0.90f)
    }
    Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun PulseDot(alpha: Float) {
  Surface(
    modifier = Modifier.size(6.dp).alpha(alpha),
    shape = CircleShape,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
  ) {}
}

@Composable
fun ChatCodeBlock(code: String, language: String?) {
  Surface(
    shape = RoundedCornerShape(12.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
    modifier = Modifier.fillMaxWidth(),
  ) {
    Text(
      text = code.trimEnd(),
      modifier = Modifier.padding(10.dp),
      fontFamily = FontFamily.Monospace,
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurface,
    )
  }
}
