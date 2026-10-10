package ai.builderforce.android.cloud

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * The workspace's Brain chats over `/api/brain/chats` — the same conversations, agents and
 * messages the web app, the VS Code extension and Synapse show (Synapse's `cloud/chat.rs`).
 */
class BrainChatApi(private val session: CloudSession) {
  suspend fun listChats(): List<BrainChat> {
    val v = session.api("GET", "/api/brain/chats?limit=$CHAT_LIMIT")
    return v.objOrNull()?.get("chats").arrOrEmpty().mapNotNull(::parseChat)
  }

  suspend fun createChat(): BrainChat {
    val v = session.api("POST", "/api/brain/chats", buildJsonObject { put("title", JsonNull) })
    return parseChat(v) ?: throw CloudException.Unreachable("the new chat has no id")
  }

  suspend fun messages(chatId: Long, limit: Int = MESSAGE_LIMIT): List<BrainMessage> {
    val v = session.api("GET", "/api/brain/chats/$chatId/messages?limit=$limit")
    return v.objOrNull()?.get("messages").arrOrEmpty().mapIndexedNotNull { i, el -> parseMessage(el, i) }
  }

  /**
   * Post the person's message. To an agent ([to]): `addressedTo` metadata, and the
   * platform dispatches that agent's reply. To the Brain: the app answers it
   * ([BrainReplyRunner]). [attachments] (already uploaded) go in the same metadata.
   */
  suspend fun send(chatId: Long, content: String, to: Recipient?, attachments: List<BrainAttachment> = emptyList()) {
    val metadata = turnMetadata(to, attachments)
    val message =
      buildJsonObject {
        put("role", JsonPrimitive("user"))
        put("content", JsonPrimitive(content))
        if (metadata != null) put("metadata", JsonPrimitive(metadata))
      }
    append(chatId, message)
  }

  /** Store one file for a message (`POST /api/brain/upload`). */
  suspend fun upload(fileName: String, mimeType: String, bytes: ByteArray): BrainAttachment =
    parseAttachment(session.upload(fileName, mimeType, bytes))
      ?: throw CloudException.Unreachable("the upload has no key")

  /** Where a stored file is read back (the link a message carries). */
  fun uploadUrl(key: String): String = uploadUrl(session.baseUrl(), key)

  /** A stored file's bytes, read as the signed-in person. */
  suspend fun uploadBytes(key: String): ByteArray = session.download(uploadPath(key))

  /** Persist the Brain's finished answer. */
  suspend fun postAssistant(chatId: Long, content: String) {
    append(
      chatId,
      buildJsonObject {
        put("role", JsonPrimitive("assistant"))
        put("content", JsonPrimitive(content))
      },
    )
  }

  private suspend fun append(chatId: Long, message: JsonObject) {
    session.api("POST", "/api/brain/chats/$chatId/messages", buildJsonObject { put("messages", JsonArray(listOf(message))) })
  }

  /** The agents assigned to a chat, named from [pool] when the assignment has no name. */
  suspend fun agents(chatId: Long, pool: List<Recipient>): List<Recipient> {
    val v = session.api("GET", "/api/brain/chats/$chatId/agents")
    return v.objOrNull()?.get("agents").arrOrEmpty().mapNotNull { el ->
      val o = el.objOrNull() ?: return@mapNotNull null
      val ref = o["agentRef"].textOrNull() ?: return@mapNotNull null
      val name = o["name"].textOrNull()?.takeIf { it.isNotBlank() } ?: pool.firstOrNull { it.ref == ref }?.name ?: ref
      Recipient(ref = ref, name = name)
    }
  }

  /**
   * The workspace's agents (its own, purchased and registered ones) — read for their
   * names. One list missing (a plan without the marketplace) must not hide the others.
   */
  suspend fun agentPool(): List<Recipient> {
    val pool = LinkedHashMap<String, Recipient>()
    for (path in POOL_PATHS) {
      val v =
        try {
          session.api("GET", path)
        } catch (e: CloudException.KeyRejected) {
          throw e
        } catch (_: CloudException) {
          continue
        }
      for (el in v.arrOrEmpty()) {
        val o = el.objOrNull() ?: continue
        if (o["isActive"].boolOrNull() == false) continue
        val id = o["id"].textOrNull() ?: continue
        pool[id] = Recipient(ref = id, name = o["name"].textOrNull() ?: id)
      }
    }
    return pool.values.sortedBy { it.name.lowercase() }
  }

  companion object {
    private const val CHAT_LIMIT = 50
    private const val MESSAGE_LIMIT = 100
    private val POOL_PATHS = listOf("/api/workforce/agents/mine", "/api/workforce/agents/purchased", "/api/agents")

    /** The tenant-checked read path of a stored upload. */
    fun uploadPath(key: String): String = "/api/brain/uploads/$key"

    fun uploadUrl(base: String, key: String): String = "$base${uploadPath(key)}"
  }
}
