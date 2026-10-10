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
   * ([BrainReplyRunner]).
   */
  suspend fun send(chatId: Long, content: String, to: Recipient?) {
    val message =
      buildJsonObject {
        put("role", JsonPrimitive("user"))
        put("content", JsonPrimitive(content))
        if (to != null) {
          val addressed =
            buildJsonObject {
              put(
                "addressedTo",
                buildJsonObject {
                  put("kind", JsonPrimitive("agent"))
                  put("ref", JsonPrimitive(to.ref))
                  put("name", JsonPrimitive(to.name))
                },
              )
            }
          put("metadata", JsonPrimitive(addressed.toString()))
        }
      }
    append(chatId, message)
  }

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

  private companion object {
    const val CHAT_LIMIT = 50
    const val MESSAGE_LIMIT = 100
    val POOL_PATHS = listOf("/api/workforce/agents/mine", "/api/workforce/agents/purchased", "/api/agents")
  }
}
