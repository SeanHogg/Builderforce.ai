package ai.builderforce.android.ui.chat

import ai.builderforce.android.R
import ai.builderforce.android.chat.LiveReply
import ai.builderforce.android.chat.QueuedMessage
import ai.builderforce.android.cloud.BrainMessage
import ai.builderforce.android.cloud.visibleMessages
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** The open chat's transcript, newest at the bottom, with the reply being written and the queue. */
@Composable
fun ChatMessageListCard(
  messages: List<BrainMessage>,
  queued: List<QueuedMessage>,
  live: LiveReply?,
  awaitingAgent: String?,
  onDecideTool: (approve: Boolean) -> Unit,
  onUnqueue: (id: Long) -> Unit,
  loadImage: AttachmentImageLoader,
  modifier: Modifier = Modifier,
) {
  val shown = remember(messages) { visibleMessages(messages) }
  val listState = rememberLazyListState()

  // With reverseLayout the newest item is at index 0 (bottom of screen).
  LaunchedEffect(shown.size, queued.size, live?.draft?.length, live?.approval, awaitingAgent) {
    listState.animateScrollToItem(index = 0)
  }

  Box(modifier = modifier.fillMaxWidth()) {
    LazyColumn(
      modifier = Modifier.fillMaxSize(),
      state = listState,
      reverseLayout = true,
      verticalArrangement = Arrangement.spacedBy(12.dp),
      contentPadding = PaddingValues(vertical = 12.dp),
    ) {
      // reverseLayout: emit newest first — queue → live reply → waiting → messages (newest→oldest).
      for (q in queued.asReversed()) {
        item(key = "queued-${q.id}") { QueuedMessageBubble(message = q, onUnqueue = { onUnqueue(q.id) }) }
      }
      if (live != null) {
        item(key = "live") { LiveReplyBubble(live = live, onDecide = onDecideTool) }
      } else if (awaitingAgent != null) {
        item(key = "awaiting") { AwaitingAgentBubble(names = awaitingAgent) }
      }
      items(count = shown.size, key = { idx -> "m-" + shown[shown.size - 1 - idx].id }) { idx ->
        ChatMessageBubble(message = shown[shown.size - 1 - idx], loadImage = loadImage)
      }
    }

    if (shown.isEmpty() && live == null && queued.isEmpty()) {
      Text(
        text = stringResource(R.string.chat_empty),
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.align(Alignment.Center).padding(horizontal = 24.dp),
      )
    }
  }
}
