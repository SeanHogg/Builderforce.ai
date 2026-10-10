package ai.builderforce.android.ui.chat

import ai.builderforce.android.R
import ai.builderforce.android.cloud.BrainChat
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** The sheet's top bar: the open chat (a picker of the workspace's chats) and a new one. */
@Composable
fun ChatTopBar(
  chats: List<BrainChat>,
  activeChatId: Long?,
  onSelect: (id: Long) -> Unit,
  onNew: () -> Unit,
) {
  var open by remember { mutableStateOf(false) }
  val active = chats.firstOrNull { it.id == activeChatId }
  val untitled = stringResource(R.string.chat_untitled)
  Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Box(modifier = Modifier.weight(1f)) {
      TextButton(onClick = { open = true }, enabled = chats.isNotEmpty()) {
        Text(
          text = if (active != null) active.title ?: untitled else stringResource(R.string.chat_pick),
          style = MaterialTheme.typography.titleMedium,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
      }
      DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        for (chat in chats) {
          DropdownMenuItem(
            text = { Text(chat.title ?: untitled, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            trailingIcon = { if (chat.id == activeChatId) Icon(Icons.Filled.Check, contentDescription = null) },
            onClick = {
              open = false
              onSelect(chat.id)
            },
          )
        }
      }
    }
    IconButton(onClick = onNew) {
      Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.chat_new))
    }
  }
}

/** Three short suggestions above an empty chat; picking one fills the box. */
@Composable
fun StarterChips(onPick: (String) -> Unit) {
  val starters =
    listOf(
      stringResource(R.string.chat_starter_1),
      stringResource(R.string.chat_starter_2),
      stringResource(R.string.chat_starter_3),
    )
  LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
    items(starters) { text ->
      SuggestionChip(onClick = { onPick(text) }, label = { Text(text, maxLines = 1) })
    }
  }
}
