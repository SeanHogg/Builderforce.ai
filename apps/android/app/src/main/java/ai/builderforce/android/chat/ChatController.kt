package ai.builderforce.android.chat

import ai.builderforce.android.cloud.BrainChat
import ai.builderforce.android.cloud.BrainChatApi
import ai.builderforce.android.cloud.BrainMessage
import ai.builderforce.android.cloud.BrainReplyRunner
import ai.builderforce.android.cloud.CloudAccount
import ai.builderforce.android.cloud.CloudException
import ai.builderforce.android.cloud.CloudProblem
import ai.builderforce.android.cloud.ImageAttachment
import ai.builderforce.android.cloud.Recipient
import ai.builderforce.android.cloud.ReplyProgress
import ai.builderforce.android.cloud.awaitingAgent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The chat sheet's state: the workspace's Brain chats (`/api/brain/chats`), the open one's
 * messages and assigned agents, and the Brain's reply while it streams in. A message to
 * the Brain is answered here ([BrainReplyRunner]); a message to an agent is answered by the
 * platform and polled for. Messages sent while a reply runs queue behind it.
 *
 * [scope] runs on the main thread: state changes are serialized there, network work
 * suspends off it.
 */
class ChatController(
  private val scope: CoroutineScope,
  private val account: CloudAccount,
  private val api: BrainChatApi,
  private val runner: BrainReplyRunner,
  private val attachments: ChatAttachments,
) {
  val signedIn: StateFlow<Boolean> = account.signedIn

  private val _chats = MutableStateFlow<List<BrainChat>>(emptyList())
  val chats: StateFlow<List<BrainChat>> = _chats.asStateFlow()

  private val _activeChatId = MutableStateFlow<Long?>(null)
  val activeChatId: StateFlow<Long?> = _activeChatId.asStateFlow()

  private val _messages = MutableStateFlow<List<BrainMessage>>(emptyList())
  val messages: StateFlow<List<BrainMessage>> = _messages.asStateFlow()

  /** The open chat's assigned agents — who the composer can address. */
  private val _agents = MutableStateFlow<List<Recipient>>(emptyList())
  val agents: StateFlow<List<Recipient>> = _agents.asStateFlow()

  private val _live = MutableStateFlow<LiveReply?>(null)
  val live: StateFlow<LiveReply?> = _live.asStateFlow()

  /** A message is going out or the Brain is replying: the composer offers Stop. */
  private val _running = MutableStateFlow(false)
  val running: StateFlow<Boolean> = _running.asStateFlow()

  private val _queued = MutableStateFlow<List<QueuedMessage>>(emptyList())
  val queued: StateFlow<List<QueuedMessage>> = _queued.asStateFlow()

  /** The agent(s) the last message is still waiting on. */
  private val _awaitingAgent = MutableStateFlow<String?>(null)
  val awaitingAgent: StateFlow<String?> = _awaitingAgent.asStateFlow()

  private val _error = MutableStateFlow<CloudProblem?>(null)
  val error: StateFlow<CloudProblem?> = _error.asStateFlow()

  private var attached = 0
  private var pollJob: Job? = null
  private var replyJob: Job? = null
  private var pool: List<Recipient>? = null
  private var nextId = 0L
  @Volatile private var approval: CompletableDeferred<Boolean>? = null

  init {
    // Signed in, out, or into another workspace or server: its chats are different ones.
    scope.launch {
      var lastSignedIn: Boolean? = null
      var lastWorkspace: Long? = null
      var lastBase: String? = null
      combine(account.signedIn, account.workspaceId, account.baseUrlOverride) { s, w, b -> Triple(s, w, b) }
        .collect { (signedIn, workspace, base) ->
          val switched = lastWorkspace != null && workspace != null && workspace != lastWorkspace
          val changed = signedIn != lastSignedIn || base != lastBase || switched
          lastSignedIn = signedIn
          lastBase = base
          lastWorkspace = if (signedIn) workspace ?: lastWorkspace else null
          if (!changed) return@collect
          reset()
          if (signedIn && attached > 0) loadChats()
        }
    }
  }

  /** The chat sheet is showing: keep its chats and messages fresh. */
  fun attach() {
    attached += 1
    if (attached > 1) return
    pollJob =
      scope.launch {
        if (signedIn.value) loadChats()
        var sinceChats = 0L
        while (isActive) {
          val wait = if (_awaitingAgent.value != null) FAST_POLL_MS else SLOW_POLL_MS
          delay(wait)
          if (!signedIn.value) continue
          loadMessages()
          sinceChats += wait
          if (sinceChats >= CHATS_POLL_MS) {
            sinceChats = 0
            loadChats()
          }
        }
      }
  }

  fun detach() {
    attached = (attached - 1).coerceAtLeast(0)
    if (attached == 0) {
      pollJob?.cancel()
      pollJob = null
    }
  }

  fun selectChat(id: Long) {
    if (id == _activeChatId.value) return
    scope.launch { open(id) }
  }

  fun newChat() {
    scope.launch {
      attempt { createAndOpen() }
    }
  }

  fun clearError() {
    _error.value = null
  }

  /**
   * Send [text] to the Brain, or to an assigned agent ([to]). [images] are stored with the
   * turn, and the Brain sees them. While a reply runs, the message queues and goes once it
   * is done.
   */
  fun send(text: String, to: Recipient?, images: List<ImageAttachment>) {
    val content = text.trim()
    if (content.isEmpty() && images.isEmpty()) return
    _error.value = null
    nextId += 1
    val item = QueuedMessage(id = nextId, chatId = _activeChatId.value, text = content, to = to, images = images)
    if (_running.value) {
      _queued.update { it + item }
      return
    }
    dispatch(item)
  }

  /** Take a queued message back before it goes. */
  fun unqueue(id: Long) {
    _queued.update { list -> list.filterNot { it.id == id } }
  }

  /** Stop the reply being written; what it wrote so far is kept. */
  fun stop() {
    replyJob?.cancel()
  }

  /** A stored image's bytes, for a turn's thumbnail; null when it cannot be read. */
  suspend fun attachmentImage(key: String): ByteArray? = attachments.imageBytes(key)

  /** The person's answer to the tool the Brain is waiting on. */
  fun decideTool(approve: Boolean) {
    approval?.complete(approve)
  }

  private fun dispatch(item: QueuedMessage) {
    _running.value = true
    replyJob =
      scope.launch {
        try {
          deliver(item)
        } finally {
          _running.value = false
          _live.value = null
          approval = null
          next()
        }
      }
  }

  private fun next() {
    val head = _queued.value.firstOrNull() ?: return
    _queued.update { it.drop(1) }
    dispatch(head)
  }

  private suspend fun deliver(item: QueuedMessage) {
    var replyChat: Long? = null
    try {
      val chatId = item.chatId ?: _activeChatId.value ?: createAndOpen().id
      val stored = attachments.upload(item.images)
      api.send(chatId, attachments.content(item.text, stored), item.to, stored)
      loadMessages()
      if (item.to == null) {
        replyChat = chatId
        _live.value = LiveReply(chatId = chatId)
        runner.reply(chatId, item.images, progressFor(chatId))
        loadMessages()
      }
      // A first message names the chat.
      loadChats()
    } catch (e: CancellationException) {
      val partial = _live.value?.draft?.trim().orEmpty()
      val stoppedIn = replyChat
      if (stoppedIn != null && partial.isNotEmpty() && signedIn.value) {
        withContext(NonCancellable) {
          attempt {
            api.postAssistant(stoppedIn, partial)
            loadMessages()
          }
        }
      }
      throw e
    } catch (e: Exception) {
      _error.value = CloudProblem.of(e)
    }
  }

  private fun progressFor(chatId: Long): ReplyProgress =
    object : ReplyProgress {
      override fun draft(text: String) {
        _live.update { it?.takeIf { live -> live.chatId == chatId }?.copy(draft = text) ?: it }
      }

      override fun activity(label: String?) {
        _live.update { it?.takeIf { live -> live.chatId == chatId }?.copy(activity = label) ?: it }
      }

      override suspend fun approve(label: String, arguments: String): Boolean {
        val decision = CompletableDeferred<Boolean>()
        approval = decision
        nextId += 1
        val ask = ToolApproval(id = nextId, label = label, arguments = arguments)
        _live.update { it?.copy(approval = ask) }
        return try {
          withTimeoutOrNull(APPROVAL_WAIT_MS) { decision.await() } ?: false
        } finally {
          approval = null
          _live.update { it?.copy(approval = null) }
        }
      }
    }

  private suspend fun createAndOpen(): BrainChat {
    val chat = api.createChat()
    _chats.update { list -> listOf(chat) + list.filterNot { it.id == chat.id } }
    open(chat.id)
    return chat
  }

  private suspend fun open(id: Long) {
    _activeChatId.value = id
    _messages.value = emptyList()
    _agents.value = emptyList()
    _awaitingAgent.value = null
    loadMessages()
    loadAgents()
  }

  /** The chat list; the open chat stays open while it is listed, else the newest opens. */
  private suspend fun loadChats() {
    attempt {
      val list = api.listChats()
      _chats.value = list
      val active = _activeChatId.value
      if (active == null || list.none { it.id == active }) {
        list.firstOrNull()?.let { open(it.id) }
      }
    }
  }

  private suspend fun loadMessages() {
    val chatId = _activeChatId.value ?: return
    attempt {
      val list = api.messages(chatId)
      if (_activeChatId.value != chatId) return@attempt
      _messages.value = list
      _awaitingAgent.value = awaitingAgent(list, System.currentTimeMillis())
    }
  }

  private suspend fun loadAgents() {
    val chatId = _activeChatId.value ?: return
    attempt {
      val names = pool ?: api.agentPool().also { pool = it }
      val assigned = api.agents(chatId, names)
      if (_activeChatId.value == chatId) _agents.value = assigned
    }
  }

  /** Run a platform call; a failure is shown, never thrown (cancellation still is). */
  private suspend fun attempt(block: suspend () -> Unit) {
    try {
      block()
    } catch (e: CloudException) {
      _error.value = CloudProblem.of(e)
    }
  }

  private fun reset() {
    replyJob?.cancel()
    replyJob = null
    _queued.value = emptyList()
    _chats.value = emptyList()
    _activeChatId.value = null
    _messages.value = emptyList()
    _agents.value = emptyList()
    _awaitingAgent.value = null
    _live.value = null
    _error.value = null
    pool = null
  }

  private companion object {
    const val FAST_POLL_MS = 2_000L
    const val SLOW_POLL_MS = 6_000L
    const val CHATS_POLL_MS = 30_000L

    /** How long a tool that changes something waits for the person before it is declined. */
    const val APPROVAL_WAIT_MS = 5 * 60_000L
  }
}
