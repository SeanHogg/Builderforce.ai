package ai.builderforce.android.cloud

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** An image the person attached, for the Brain's turn. */
data class ImageAttachment(val fileName: String, val mimeType: String, val base64: String)

/** What the runner reports while a reply is being written. */
interface ReplyProgress {
  /** The answer so far (every round of it). */
  fun draft(text: String)

  /** The tool in use, by its readable name; null once it returned. */
  fun activity(label: String?)

  /** Hold a tool that changes something for the person's go-ahead. Silence is a no. */
  suspend fun approve(label: String, arguments: String): Boolean
}

/** The model streamed nothing to say. */
class EmptyAnswerException : Exception("the model returned an empty answer")

/**
 * The Brain's reply in a chat — Synapse's `brain.rs`. The platform answers only messages
 * addressed to an agent; the Brain's own turn is run by the surface the person is in,
 * through the same loop: the model streams its answer (`/llm/v1/chat/completions`) and
 * may call the platform's tools (the `/llm/v1/mcp` routes), each run as the person; then the
 * answer is persisted to the chat. A tool that only reads runs at once; one that changes
 * something waits for the person's Approve. Cancel the coroutine to stop.
 */
class BrainReplyRunner(
  private val session: CloudSession,
  private val chats: BrainChatApi,
  private val tools: PlatformTools,
) {
  suspend fun reply(chatId: Long, images: List<ImageAttachment>, progress: ReplyProgress) {
    val (convo, question) = conversation(chats.messages(chatId, limit = HISTORY))
    if (question.isEmpty()) return

    val prompt = mutableListOf<JsonElement>(message("system", JsonPrimitive(SYSTEM)))
    prompt += withImages(convo, images)

    // An unreachable catalog is an answer without tools, never no answer.
    val catalog =
      try {
        tools.list(SURFACE)
      } catch (e: CloudException.KeyRejected) {
        throw e
      } catch (_: CloudException) {
        emptyList()
      }
    var offered: List<JsonElement> = catalog.map { it.asFunction() }

    val draft = StringBuilder()
    var failures = 0
    while (true) {
      val body =
        buildJsonObject {
          put("messages", JsonArray(prompt.toList()))
          if (offered.isNotEmpty()) put("tools", JsonArray(offered))
        }
      // Each round's text continues the same reply, a paragraph apart.
      var first = true
      val turn =
        streamChat(session, body) { piece ->
          if (first && draft.isNotEmpty()) draft.append("\n\n")
          first = false
          draft.append(piece)
          progress.draft(draft.toString())
        }
      if (turn.toolCalls.isEmpty() || offered.isEmpty()) break

      prompt +=
        buildJsonObject {
          put("role", JsonPrimitive("assistant"))
          put("content", JsonPrimitive(turn.text))
          put("tool_calls", JsonArray(turn.toolCalls.map { toolCallJson(it) }))
        }
      for (call in turn.toolCalls) {
        val content =
          when (val outcome = runTool(catalog, call, progress)) {
            is Outcome.Ran -> {
              failures = 0
              outcome.output
            }
            Outcome.Declined -> DECLINED
            is Outcome.Failed -> {
              failures += 1
              buildJsonObject { put("error", JsonPrimitive(outcome.why)) }.toString()
            }
          }
        prompt +=
          buildJsonObject {
            put("role", JsonPrimitive("tool"))
            put("tool_call_id", JsonPrimitive(call.id))
            put("content", JsonPrimitive(content))
          }
      }
      // Failing over and over: the next round answers without tools, from what the calls returned.
      if (failures >= FAILURE_STREAK) offered = emptyList()
    }

    val answer = draft.toString().trim()
    if (answer.isEmpty()) throw EmptyAnswerException()
    chats.postAssistant(chatId, answer)
  }

  private sealed interface Outcome {
    data class Ran(val output: String) : Outcome

    data object Declined : Outcome

    data class Failed(val why: String) : Outcome
  }

  private suspend fun runTool(catalog: List<PlatformTool>, call: ToolCall, progress: ReplyProgress): Outcome {
    val tool = catalog.firstOrNull { it.name == call.name } ?: return Outcome.Failed("there is no tool named ${call.name}")
    val raw = call.arguments.ifBlank { "{}" }
    val args = parseCloudBody(raw) as? JsonObject ?: return Outcome.Failed("the arguments for ${call.name} are not a JSON object")
    val label = toolLabel(tool.name)
    if (tool.writes && !progress.approve(label, args.toString())) return Outcome.Declined
    progress.activity(label)
    return try {
      Outcome.Ran(tools.call(tool, args).take(RESULT_CHARS))
    } catch (e: CloudException.KeyRejected) {
      throw e
    } catch (e: CloudException) {
      Outcome.Failed(e.message.orEmpty())
    } finally {
      progress.activity(null)
    }
  }

  internal companion object {
    /** How much of the conversation the Brain reads. */
    const val HISTORY = 24

    /** The catalog the Brain is offered: delivery work, not the platform's administration. */
    const val SURFACE = "delivery"

    /** How much of one tool's result the model reads back. */
    const val RESULT_CHARS = 16_000

    /** Tool calls failing this many times in a row end the tools for this reply. */
    const val FAILURE_STREAK = 5

    private val DECLINED =
      buildJsonObject {
        put("cancelled", JsonPrimitive(true))
        put("reason", JsonPrimitive("the person declined this action"))
      }.toString()

    const val SYSTEM =
      "You are the Brain in Builderforce for Android, the person's phone app. Answer directly and " +
        "concisely — they are reading on a phone. You can see the conversation. You have the workspace's " +
        "platform tools (`builtin_<domain>_<method>`: projects, tickets, boards, specs, OKRs, and the " +
        "workspace's connectors). Resolve names to ids with the list/get tools before acting. Read-only tools " +
        "run at once; a tool that changes something is shown to the person to approve, so call it directly " +
        "when you have the details — if they decline you get `{\"cancelled\": true}`, so adjust rather than " +
        "retry. Never say you did something unless the tool returned success. Code work and long-running work " +
        "belong to an assigned agent: say which one should take it, and the person can address it with @ or " +
        "the To choice."

    private fun message(role: String, content: JsonElement): JsonObject =
      buildJsonObject {
        put("role", JsonPrimitive(role))
        put("content", content)
      }

    private fun toolCallJson(c: ToolCall): JsonObject =
      buildJsonObject {
        put("id", JsonPrimitive(c.id))
        put("type", JsonPrimitive("function"))
        put(
          "function",
          buildJsonObject {
            put("name", JsonPrimitive(c.name))
            put("arguments", JsonPrimitive(c.arguments))
          },
        )
      }

    /**
     * The conversation so far, as the model reads it, and the person's latest question.
     * Another participant's reply is shown to the Brain as theirs, not its own.
     */
    fun conversation(messages: List<BrainMessage>): Pair<List<JsonObject>, String> {
      val convo =
        messages.takeLast(HISTORY).mapNotNull { m ->
          val content = m.content.trim()
          if (content.isEmpty() || (m.role != "user" && m.role != "assistant")) return@mapNotNull null
          val shown = m.authorName?.let { "[$it] $content" } ?: content
          message(m.role, JsonPrimitive(shown))
        }
      val question = convo.lastOrNull { it["role"].textOrNull() == "user" }?.get("content").textOrNull().orEmpty()
      return convo to question
    }

    /** The person's images ride on their latest turn, as the model's image parts. */
    fun withImages(convo: List<JsonObject>, images: List<ImageAttachment>): List<JsonObject> {
      if (images.isEmpty()) return convo
      val at = convo.indexOfLast { it["role"].textOrNull() == "user" }
      if (at < 0) return convo
      val text = convo[at]["content"].textOrNull().orEmpty()
      val parts =
        buildList {
          add(
            buildJsonObject {
              put("type", JsonPrimitive("text"))
              put("text", JsonPrimitive(text))
            },
          )
          for (img in images) {
            add(
              buildJsonObject {
                put("type", JsonPrimitive("image_url"))
                put("image_url", buildJsonObject { put("url", JsonPrimitive("data:${img.mimeType};base64,${img.base64}")) })
              },
            )
          }
        }
      return convo.toMutableList().also { it[at] = message("user", JsonArray(parts)) }
    }
  }
}
