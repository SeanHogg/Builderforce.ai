package ai.builderforce.android

import ai.builderforce.android.chat.ChatAttachments
import ai.builderforce.android.chat.ChatController
import ai.builderforce.android.cloud.BrainChatApi
import ai.builderforce.android.cloud.BrainReplyRunner
import ai.builderforce.android.cloud.CloudAccount
import ai.builderforce.android.cloud.CloudConfig
import ai.builderforce.android.cloud.CloudSession
import ai.builderforce.android.cloud.PlatformTools
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * The app's Builderforce cloud side — the account and the Brain chat — wired once. Chat
 * lives here, on builderforce.ai; the phone's node features stay on the local gateway
 * ([NodeRuntime]).
 */
class CloudServices(prefs: SecurePrefs) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val config = CloudConfig(prefs)
  private val session = CloudSession(prefs, config)
  private val chatApi = BrainChatApi(session)

  val account: CloudAccount = CloudAccount(scope, session, config)

  val chat: ChatController =
    ChatController(
      scope = scope,
      account = account,
      api = chatApi,
      runner = BrainReplyRunner(session, chatApi, PlatformTools(session)),
      attachments = ChatAttachments(chatApi),
    )
}
