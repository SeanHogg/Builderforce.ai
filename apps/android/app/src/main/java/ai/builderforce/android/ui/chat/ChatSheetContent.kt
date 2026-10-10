package ai.builderforce.android.ui.chat

import ai.builderforce.android.MainViewModel
import ai.builderforce.android.R
import ai.builderforce.android.cloud.ImageAttachment
import ai.builderforce.android.cloud.visibleMessages
import android.content.ContentResolver
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.io.ByteArrayOutputStream
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Chat with the Builderforce Brain: sign in, pick a chat, talk. */
@Composable
fun ChatSheetContent(viewModel: MainViewModel) {
  val chat = viewModel.chat
  val account = viewModel.account
  val signedIn by chat.signedIn.collectAsState()
  val signIn by account.signIn.collectAsState()
  val expired by account.expired.collectAsState()

  DisposableEffect(chat) {
    chat.attach()
    onDispose { chat.detach() }
  }

  Column(
    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    if (!signedIn) {
      SignInCard(
        state = signIn,
        expired = expired,
        onSignIn = account::beginSignIn,
        onCancel = account::cancelSignIn,
      )
    } else {
      SignedInChat(viewModel)
    }
  }
}

@Composable
private fun ColumnScope.SignedInChat(viewModel: MainViewModel) {
  val chat = viewModel.chat
  val chats by chat.chats.collectAsState()
  val activeChatId by chat.activeChatId.collectAsState()
  val messages by chat.messages.collectAsState()
  val agents by chat.agents.collectAsState()
  val live by chat.live.collectAsState()
  val running by chat.running.collectAsState()
  val queued by chat.queued.collectAsState()
  val awaitingAgent by chat.awaitingAgent.collectAsState()
  val problem by chat.error.collectAsState()

  val resolver = LocalContext.current.contentResolver
  val scope = rememberCoroutineScope()
  var input by rememberSaveable { mutableStateOf("") }
  val attachments = remember { mutableStateListOf<PendingImageAttachment>() }
  var localError by remember { mutableStateOf<Int?>(null) }

  val pickImages =
    rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
      if (uris.isNullOrEmpty()) return@rememberLauncherForActivityResult
      scope.launch {
        val loaded = withContext(Dispatchers.IO) { uris.take(MAX_IMAGES).map { loadImageAttachment(resolver, it) } }
        attachments.addAll(loaded.filterNotNull())
        if (loaded.any { it == null }) localError = R.string.chat_image_unreadable
      }
    }

  val liveHere = live?.takeIf { it.chatId == activeChatId }
  val queuedHere = queued.filter { it.chatId == activeChatId || it.chatId == null }
  val empty = visibleMessages(messages).isEmpty() && liveHere == null && queuedHere.isEmpty()
  val errorText = localError?.let { stringResource(it) } ?: problem?.let { cloudProblemText(it) }

  ChatTopBar(chats = chats, activeChatId = activeChatId, onSelect = chat::selectChat, onNew = chat::newChat)

  ChatMessageListCard(
    messages = messages,
    queued = queuedHere,
    live = liveHere,
    awaitingAgent = awaitingAgent,
    onDecideTool = chat::decideTool,
    onUnqueue = chat::unqueue,
    loadImage = chat::attachmentImage,
    modifier = Modifier.weight(1f, fill = true),
  )

  if (empty) {
    StarterChips(onPick = { input = it })
  }

  ChatComposer(
    value = input,
    onValueChange = {
      input = it
      localError = null
    },
    attachments = attachments,
    agents = agents,
    running = running,
    errorText = errorText,
    onPickImages = { pickImages.launch("image/*") },
    onRemoveAttachment = { id -> attachments.removeAll { it.id == id } },
    onSend = { to ->
      val images = attachments.map { ImageAttachment(fileName = it.fileName, mimeType = it.mimeType, base64 = it.base64) }
      chat.send(text = input, to = to, images = images)
      input = ""
      attachments.clear()
      localError = null
    },
    onStop = chat::stop,
    onDictationDenied = { localError = R.string.chat_mic_denied },
  )
}

/** An image picked for the Brain's turn, until it is sent. */
data class PendingImageAttachment(
  val id: String,
  val fileName: String,
  val mimeType: String,
  val base64: String,
)

private const val MAX_IMAGES = 8

private fun loadImageAttachment(resolver: ContentResolver, uri: Uri): PendingImageAttachment? {
  val bytes =
    try {
      resolver.openInputStream(uri)?.use { input ->
        val out = ByteArrayOutputStream()
        input.copyTo(out)
        out.toByteArray()
      }
    } catch (_: IOException) {
      null
    } catch (_: SecurityException) {
      null
    }
  if (bytes == null || bytes.isEmpty()) return null
  return PendingImageAttachment(
    id = "$uri#${System.nanoTime()}",
    fileName = (uri.lastPathSegment ?: "image").substringAfterLast('/'),
    mimeType = resolver.getType(uri) ?: "image/*",
    base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
  )
}
